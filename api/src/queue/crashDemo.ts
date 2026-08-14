import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pool } from "../db/pool.js";
import { startRun } from "./startRun.js";
import type { WorkflowDefinition } from "../dag/types.js";

// Repeatable crash-recovery demo: start a run, kill -9 the worker mid-step, watch
// a second worker pick up exactly where the first died. Run: npm run demo:crash -w api
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const tsxBin = path.join(repoRoot, "node_modules/.bin/tsx");
const workerEntry = path.resolve(here, "worker-entry.ts");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function eventCount(runId: string, nodeId: string, type: string): Promise<number> {
  const { rows: [r] } = await pool.query<{ count: string }>(
    `SELECT count(*) FROM run_events WHERE run_id = $1 AND node_id = $2 AND event_type = $3`,
    [runId, nodeId, type],
  );
  return Number(r.count);
}

async function main() {
  const def: WorkflowDefinition = {
    nodes: [
      { id: "fetch", type: "noop", config: {} },
      { id: "process", type: "sleep", config: { ms: 4000 } },
      { id: "notify", type: "noop", config: {} },
    ],
    edges: [
      { from: "fetch", to: "process" },
      { from: "process", to: "notify" },
    ],
  };
  const { rows: [wf] } = await pool.query<{ id: string }>(
    `INSERT INTO workflows (name, definition) VALUES ('crash-demo', $1) RETURNING id`,
    [JSON.stringify(def)],
  );
  const { runId } = await startRun(wf.id);
  console.log(`\n▶  started run ${runId}  (fetch -> process[4s] -> notify)\n`);

  // detached so a SIGKILL to the group (-pid) also takes down the node child tsx
  // spawns — otherwise the real worker orphans and keeps running.
  const w1 = spawn(tsxBin, [workerEntry, "worker-1"], { env: process.env, stdio: "inherit", detached: true });
  console.log(`▶  worker-1 running (pid ${w1.pid})`);

  while ((await eventCount(runId, "process", "step_started")) < 1) await sleep(50);
  console.log(`\n💥 'process' is mid-execution — kill -9 worker-1 (pid ${w1.pid}) NOW\n`);
  if (w1.pid) process.kill(-w1.pid, "SIGKILL");
  await once(w1, "exit");
  console.log(`   worker-1 dead. 'fetch' is done, 'process' is stranded 'claimed' with no completion.\n`);

  const w2 = spawn(tsxBin, [workerEntry, "worker-2"], {
    env: { ...process.env, WORKER_STUCK_TIMEOUT_MS: "300", WORKER_SWEEP_INTERVAL_MS: "150", WORKER_IDLE_EXIT_MS: "6000" },
    stdio: "inherit",
    detached: true,
  });
  console.log(`▶  worker-2 running (pid ${w2.pid}) — it will sweep, reclaim 'process', and finish the run\n`);

  const start = Date.now();
  while (Date.now() - start < 25_000) {
    const { rows: [run] } = await pool.query<{ status: string }>(`SELECT status FROM runs WHERE id = $1`, [runId]);
    if (run.status === "completed" || run.status === "failed") break;
    await sleep(150);
  }
  await once(w2, "exit");

  const { rows: timeline } = await pool.query<{ node_id: string; event_type: string; worker: string | null }>(
    `SELECT node_id, event_type, payload->>'worker' AS worker FROM run_events WHERE run_id = $1 ORDER BY id`,
    [runId],
  );
  const { rows: [run] } = await pool.query<{ status: string }>(`SELECT status FROM runs WHERE id = $1`, [runId]);
  console.log(`\n── event timeline ─────────────────────────────`);
  for (const e of timeline) {
    console.log(`   ${e.node_id.padEnd(9)} ${e.event_type.padEnd(15)} ${e.worker ?? ""}`);
  }
  console.log(`── run status: ${run.status} ────────────────────\n`);
  console.log("Note: 'process' shows step_started TWICE (worker-1, then worker-2) but");
  console.log("step_completed ONCE. 'fetch' ran once and was never re-run.\n");

  await pool.query(`DELETE FROM run_events WHERE run_id = $1`, [runId]);
  await pool.query(`DELETE FROM jobs WHERE run_id = $1`, [runId]);
  await pool.query(`DELETE FROM runs WHERE id = $1`, [runId]);
  await pool.query(`DELETE FROM workflows WHERE id = $1`, [wf.id]);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
