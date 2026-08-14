import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, ChildProcess } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pool } from "../../db/pool.js";
import { startRun } from "../startRun.js";
import type { WorkflowDefinition } from "../../dag/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const tsxBin = path.join(repoRoot, "node_modules/.bin/tsx");
const workerEntry = path.resolve(here, "../worker-entry.ts");

after(async () => {
  await pool.end();
});

// detached: true puts the worker in its own process group so a SIGKILL to the
// group (-pid) takes down tsx AND the node child it spawns. Killing only the tsx
// parent would orphan the real worker, which would keep running and double-execute.
function spawnWorker(id: string, env: Record<string, string>): ChildProcess {
  return spawn(tsxBin, [workerEntry, id], { env: { ...process.env, ...env }, stdio: "inherit", detached: true });
}

function killGroup(child: ChildProcess): void {
  try {
    if (child.pid) process.kill(-child.pid, "SIGKILL");
  } catch {
    // already dead
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function eventCount(runId: string, nodeId: string, eventType: string): Promise<number> {
  const { rows: [r] } = await pool.query<{ count: string }>(
    `SELECT count(*) FROM run_events WHERE run_id = $1 AND node_id = $2 AND event_type = $3`,
    [runId, nodeId, eventType],
  );
  return Number(r.count);
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number, label: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await sleep(25);
  }
  throw new Error(`timed out waiting for: ${label}`);
}

test("kill -9 mid-execution: run resumes, completed steps are not re-run, killed step reruns exactly once", async () => {
  // A (instant) -> B (sleeps 3s, we kill the worker while it's here) -> C (instant)
  const def: WorkflowDefinition = {
    nodes: [
      { id: "A", type: "noop", config: {} },
      { id: "B", type: "sleep", config: { ms: 3000 } },
      { id: "C", type: "noop", config: {} },
    ],
    edges: [
      { from: "A", to: "B" },
      { from: "B", to: "C" },
    ],
  };
  const { rows: [wf] } = await pool.query<{ id: string }>(
    `INSERT INTO workflows (name, definition) VALUES ('crashtest', $1) RETURNING id`,
    [JSON.stringify(def)],
  );
  const { runId } = await startRun(wf.id);

  const w1 = spawnWorker("w1", {}); // long-lived, no idle exit
  try {
    // B's step_started means A already completed (B is only enqueued after A's
    // step_completed) and the worker is now parked in B's 3s sleep.
    await waitFor(async () => (await eventCount(runId, "B", "step_started")) >= 1, 10_000, "B started");
    assert.equal(await eventCount(runId, "A", "step_completed"), 1, "A completed before the crash");
    assert.equal(await eventCount(runId, "B", "step_completed"), 0, "B not yet completed");

    // Kill -9 mid-execution — the whole worker process group.
    killGroup(w1);
    await once(w1, "exit");

    // A recovering worker: short stuck-timeout + frequent sweep so it reclaims B,
    // finishes B and C, then idle-exits.
    const w2 = spawnWorker("w2", {
      WORKER_STUCK_TIMEOUT_MS: "250",
      WORKER_SWEEP_INTERVAL_MS: "100",
      WORKER_IDLE_EXIT_MS: "5000",
    });

    await waitFor(
      async () => {
        const { rows: [run] } = await pool.query<{ status: string }>(`SELECT status FROM runs WHERE id = $1`, [runId]);
        return run.status === "completed";
      },
      20_000,
      "run completed",
    );
    await once(w2, "exit");

    // Completed steps were not re-run: A and C started/completed exactly once.
    assert.equal(await eventCount(runId, "A", "step_started"), 1, "A not re-run");
    assert.equal(await eventCount(runId, "A", "step_completed"), 1);
    assert.equal(await eventCount(runId, "C", "step_started"), 1);
    assert.equal(await eventCount(runId, "C", "step_completed"), 1);

    // The killed step re-ran exactly once and completed exactly once (the crash
    // signature: two step_started, one step_completed).
    assert.equal(await eventCount(runId, "B", "step_started"), 2, "B started once by w1, once by w2");
    assert.equal(await eventCount(runId, "B", "step_completed"), 1, "B completed exactly once — no lost, no duplicate");

    const { rows: jobs } = await pool.query<{ node_id: string; status: string; attempts: number }>(
      `SELECT node_id, status, attempts FROM jobs WHERE run_id = $1 ORDER BY node_id`,
      [runId],
    );
    assert.deepEqual(jobs.map((j) => `${j.node_id}:${j.status}`), ["A:done", "B:done", "C:done"]);
    assert.ok(jobs.find((j) => j.node_id === "B")!.attempts >= 2, "B was claimed by both workers");
  } finally {
    killGroup(w1);
    await pool.query(`DELETE FROM run_events WHERE run_id = $1`, [runId]);
    await pool.query(`DELETE FROM jobs WHERE run_id = $1`, [runId]);
    await pool.query(`DELETE FROM runs WHERE id = $1`, [runId]);
    await pool.query(`DELETE FROM workflows WHERE id = $1`, [wf.id]);
  }
});
