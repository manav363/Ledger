import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../db/pool.js";
import { claimJob } from "../claimJob.js";
import { runJob } from "../runJob.js";
import { startRun } from "../startRun.js";
import type { WorkflowDefinition } from "../../dag/types.js";

after(async () => {
  await pool.end();
});

async function createWorkflow(def: WorkflowDefinition): Promise<string> {
  const { rows: [wf] } = await pool.query<{ id: string }>(
    `INSERT INTO workflows (name, definition) VALUES ('dagtest', $1) RETURNING id`,
    [JSON.stringify(def)],
  );
  return wf.id;
}

// Drive the run to completion by claiming + running jobs in-process, exactly as
// a worker would. Returns when the run reaches a terminal status.
async function drain(runId: string): Promise<string> {
  for (let i = 0; i < 200; i++) {
    const job = await claimJob("test-worker");
    if (job) {
      await runJob(job, "test-worker");
      continue;
    }
    const { rows: [run] } = await pool.query<{ status: string }>(
      `SELECT status FROM runs WHERE id = $1`,
      [runId],
    );
    if (run.status === "completed" || run.status === "failed") return run.status;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("run did not reach a terminal status");
}

async function cleanup(workflowId: string, runId: string): Promise<void> {
  await pool.query(`DELETE FROM run_events WHERE run_id = $1`, [runId]);
  await pool.query(`DELETE FROM jobs WHERE run_id = $1`, [runId]);
  await pool.query(`DELETE FROM runs WHERE id = $1`, [runId]);
  await pool.query(`DELETE FROM workflows WHERE id = $1`, [workflowId]);
}

async function eventLog(runId: string): Promise<{ node_id: string; event_type: string }[]> {
  const { rows } = await pool.query<{ node_id: string; event_type: string }>(
    `SELECT node_id, event_type FROM run_events WHERE run_id = $1 ORDER BY id`,
    [runId],
  );
  return rows;
}

test("linear chain A->B->C runs in order and threads output as downstream input", async () => {
  const wf = await createWorkflow({
    nodes: [
      { id: "A", type: "noop", config: { emit: "hello" } },
      { id: "B", type: "noop", config: {} },
      { id: "C", type: "noop", config: {} },
    ],
    edges: [
      { from: "A", to: "B" },
      { from: "B", to: "C" },
    ],
  });
  const { runId } = await startRun(wf);
  try {
    assert.equal(await drain(runId), "completed");

    // Order is guaranteed because a node is only enqueued after its parent's
    // step_completed exists.
    const completed = (await eventLog(runId)).filter((e) => e.event_type === "step_completed").map((e) => e.node_id);
    assert.deepEqual(completed, ["A", "B", "C"]);

    // B's output must carry A's output as input (threaded through the event log).
    const { rows: [bEvent] } = await pool.query<{ payload: { output: { input?: Record<string, unknown> } } }>(
      `SELECT payload FROM run_events WHERE run_id = $1 AND node_id = 'B' AND event_type = 'step_completed'`,
      [runId],
    );
    assert.deepEqual(bEvent.payload.output.input, { A: { node_id: "A", value: "hello" } });
  } finally {
    await cleanup(wf, runId);
  }
});

test("parallel fan-out A->B, A->C runs both branches", async () => {
  const wf = await createWorkflow({
    nodes: [
      { id: "A", type: "noop", config: {} },
      { id: "B", type: "noop", config: {} },
      { id: "C", type: "noop", config: {} },
    ],
    edges: [
      { from: "A", to: "B" },
      { from: "A", to: "C" },
    ],
  });
  const { runId } = await startRun(wf);
  try {
    assert.equal(await drain(runId), "completed");
    const done = new Set(
      (await pool.query<{ node_id: string }>(`SELECT node_id FROM jobs WHERE run_id = $1 AND status = 'done'`, [runId])).rows.map((r) => r.node_id),
    );
    assert.deepEqual([...done].sort(), ["A", "B", "C"]);
  } finally {
    await cleanup(wf, runId);
  }
});

test("conditional branch takes only the matching edge; the other node never runs", async () => {
  const wf = await createWorkflow({
    nodes: [
      { id: "A", type: "noop", config: { emit: 200 } },
      { id: "ok", type: "noop", config: {} },
      { id: "err", type: "noop", config: {} },
    ],
    edges: [
      { from: "A", to: "ok", when: { path: "value", op: "lt", value: 400 } },
      { from: "A", to: "err", when: { path: "value", op: "gte", value: 400 } },
    ],
  });
  const { runId } = await startRun(wf);
  try {
    assert.equal(await drain(runId), "completed");
    const jobs = (await pool.query<{ node_id: string; status: string }>(`SELECT node_id, status FROM jobs WHERE run_id = $1`, [runId])).rows;
    const byNode = Object.fromEntries(jobs.map((j) => [j.node_id, j.status]));
    assert.equal(byNode.A, "done");
    assert.equal(byNode.ok, "done");
    assert.equal(byNode.err, undefined, "the not-taken branch was never enqueued");
  } finally {
    await cleanup(wf, runId);
  }
});

test("fan-in join waits for all parents and is enqueued exactly once", async () => {
  const wf = await createWorkflow({
    nodes: [
      { id: "A", type: "noop", config: {} },
      { id: "B", type: "noop", config: {} },
      { id: "C", type: "noop", config: {} },
    ],
    edges: [
      { from: "A", to: "C" },
      { from: "B", to: "C" },
    ],
  });
  const { runId } = await startRun(wf);
  try {
    assert.equal(await drain(runId), "completed");

    const { rows: [jobCount] } = await pool.query<{ count: string }>(
      `SELECT count(*) FROM jobs WHERE run_id = $1 AND node_id = 'C'`,
      [runId],
    );
    assert.equal(jobCount.count, "1", "join node has exactly one job row");

    const { rows: [evCount] } = await pool.query<{ count: string }>(
      `SELECT count(*) FROM run_events WHERE run_id = $1 AND node_id = 'C' AND event_type = 'step_completed'`,
      [runId],
    );
    assert.equal(evCount.count, "1", "join node completed exactly once");

    // C sees both parents' outputs as input.
    const { rows: [cEvent] } = await pool.query<{ payload: { output: { input?: Record<string, unknown> } } }>(
      `SELECT payload FROM run_events WHERE run_id = $1 AND node_id = 'C' AND event_type = 'step_completed'`,
      [runId],
    );
    assert.deepEqual(Object.keys(cEvent.payload.output.input ?? {}).sort(), ["A", "B"]);
  } finally {
    await cleanup(wf, runId);
  }
});
