import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pool } from "../../db/pool.js";

const JOB_COUNT = 500;
const WORKER_COUNT = 5;

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const tsxBin = path.join(repoRoot, "node_modules/.bin/tsx");
const workerEntry = path.resolve(here, "../worker-entry.ts");

function runWorker(workerId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(tsxBin, [workerEntry, workerId], {
      env: { ...process.env, WORKER_IDLE_EXIT_MS: "500" },
      stdio: "inherit",
    });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${workerId} exited ${code}`))));
    child.on("error", reject);
  });
}

test("5 concurrent worker processes claim 500 jobs with zero double-claims", async () => {
  // noop nodes so the workers run the real execution path with no side effects.
  const nodes = Array.from({ length: JOB_COUNT }, (_, i) => ({
    id: `node-${i}`,
    type: "noop",
    config: {},
  }));
  const { rows: [workflow] } = await pool.query<{ id: string }>(
    `INSERT INTO workflows (name, definition) VALUES ('loadtest', $1) RETURNING id`,
    [JSON.stringify({ nodes, edges: [] })],
  );
  const { rows: [run] } = await pool.query<{ id: string }>(
    `INSERT INTO runs (workflow_id) VALUES ($1) RETURNING id`,
    [workflow.id],
  );

  try {
    for (let i = 0; i < JOB_COUNT; i++) {
      await pool.query(`INSERT INTO jobs (run_id, node_id) VALUES ($1, $2)`, [run.id, `node-${i}`]);
    }

    await Promise.all(
      Array.from({ length: WORKER_COUNT }, (_, i) => runWorker(`worker-${i}`)),
    );

    const { rows: statusCounts } = await pool.query<{ status: string; count: string }>(
      `SELECT status, count(*) FROM jobs WHERE run_id = $1 GROUP BY status`,
      [run.id],
    );
    assert.deepEqual(statusCounts, [{ status: "done", count: String(JOB_COUNT) }]);

    const { rows: events } = await pool.query<{ node_id: string; count: string }>(
      `SELECT node_id, count(*) FROM run_events WHERE run_id = $1 AND event_type = 'step_completed' GROUP BY node_id`,
      [run.id],
    );
    assert.equal(events.length, JOB_COUNT, "every job produced exactly one step_completed event");
    assert.ok(
      events.every((e) => e.count === "1"),
      "no node_id was completed more than once (no double-claim slipped through)",
    );
  } finally {
    await pool.query(`DELETE FROM run_events WHERE run_id = $1`, [run.id]);
    await pool.query(`DELETE FROM jobs WHERE run_id = $1`, [run.id]);
    await pool.query(`DELETE FROM runs WHERE id = $1`, [run.id]);
    await pool.query(`DELETE FROM workflows WHERE id = $1`, [workflow.id]);
    await pool.end();
  }
});
