import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import { pool } from "../../db/pool.js";
import { claimJob } from "../claimJob.js";
import { runJob } from "../runJob.js";

interface NodeDef {
  id: string;
  type: string;
  config: Record<string, unknown>;
}

let server: http.Server;
let baseUrl: string;
let deadPort: number;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/ok") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ hello: "world" }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;

  // Bind then immediately free a port to get one guaranteed to refuse connects.
  const tmp = http.createServer();
  await new Promise<void>((resolve) => tmp.listen(0, "127.0.0.1", resolve));
  deadPort = (tmp.address() as AddressInfo).port;
  await new Promise<void>((resolve) => tmp.close(() => resolve()));
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

async function seedRun(node: NodeDef): Promise<{ workflowId: string; runId: string }> {
  const { rows: [workflow] } = await pool.query<{ id: string }>(
    `INSERT INTO workflows (name, definition) VALUES ($1, $2) RETURNING id`,
    [`httptest-${node.id}`, JSON.stringify({ nodes: [node], edges: [] })],
  );
  const { rows: [run] } = await pool.query<{ id: string }>(
    `INSERT INTO runs (workflow_id) VALUES ($1) RETURNING id`,
    [workflow.id],
  );
  await pool.query(`INSERT INTO jobs (run_id, node_id) VALUES ($1, $2)`, [run.id, node.id]);
  return { workflowId: workflow.id, runId: run.id };
}

async function cleanup(workflowId: string, runId: string): Promise<void> {
  await pool.query(`DELETE FROM run_events WHERE run_id = $1`, [runId]);
  await pool.query(`DELETE FROM jobs WHERE run_id = $1`, [runId]);
  await pool.query(`DELETE FROM runs WHERE id = $1`, [runId]);
  await pool.query(`DELETE FROM workflows WHERE id = $1`, [workflowId]);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("http node executes, completes the job, and captures the response as output", async () => {
  const { workflowId, runId } = await seedRun({
    id: "fetch-ok",
    type: "http",
    config: { method: "GET", url: `${baseUrl}/ok` },
  });
  try {
    const job = await claimJob("test-worker");
    assert.ok(job, "a job was claimable");
    const outcome = await runJob(job, "test-worker");
    assert.equal(outcome, "done");

    const { rows } = await pool.query<{ event_type: string; payload: { output?: { status: number; body: { hello: string } } } }>(
      `SELECT event_type, payload FROM run_events WHERE run_id = $1 ORDER BY id`,
      [runId],
    );
    assert.deepEqual(rows.map((r) => r.event_type), ["step_started", "step_completed"]);
    const output = rows[1].payload.output;
    assert.equal(output?.status, 200);
    assert.equal(output?.body.hello, "world");

    const { rows: [jobRow] } = await pool.query<{ status: string }>(
      `SELECT status FROM jobs WHERE run_id = $1`,
      [runId],
    );
    assert.equal(jobRow.status, "done");
  } finally {
    await cleanup(workflowId, runId);
  }
});

test("http node transport failure retries with backoff, then fails after max attempts", async () => {
  process.env.WORKER_BACKOFF_MS = "10"; // keep the exponential backoff test-fast
  const { workflowId, runId } = await seedRun({
    id: "fetch-dead",
    type: "http",
    config: { method: "GET", url: `http://127.0.0.1:${deadPort}/` },
  });
  try {
    // Drain: claim + run until the job leaves the queue (done/failed), honoring
    // the future available_at that backoff sets.
    for (let i = 0; i < 50; i++) {
      const job = await claimJob("test-worker");
      if (job) {
        await runJob(job, "test-worker");
        continue;
      }
      const { rows: [row] } = await pool.query<{ status: string }>(
        `SELECT status FROM jobs WHERE run_id = $1`,
        [runId],
      );
      if (row.status === "failed" || row.status === "done") break;
      await sleep(15);
    }

    const { rows: [jobRow] } = await pool.query<{ status: string; attempts: number }>(
      `SELECT status, attempts FROM jobs WHERE run_id = $1`,
      [runId],
    );
    assert.equal(jobRow.status, "failed");
    assert.equal(jobRow.attempts, 3);

    const { rows: eventCounts } = await pool.query<{ event_type: string; count: string }>(
      `SELECT event_type, count(*) FROM run_events WHERE run_id = $1 GROUP BY event_type`,
      [runId],
    );
    const counts = Object.fromEntries(eventCounts.map((e) => [e.event_type, Number(e.count)]));
    assert.equal(counts.step_started, 3, "one step_started per attempt");
    assert.equal(counts.retry, 2, "two retries before giving up");
    assert.equal(counts.step_failed, 1, "one terminal failure");
  } finally {
    delete process.env.WORKER_BACKOFF_MS;
    await cleanup(workflowId, runId);
  }
});
