import { claimJob } from "./claimJob.js";
import { runJob } from "./runJob.js";
import { recoverStuckJobs } from "./recoverStuckJobs.js";
import { pool } from "../db/pool.js";

const workerId = process.argv[2] ?? `worker-${process.pid}`;
const pollIntervalMs = 20;
// How often an idle worker sweeps for jobs abandoned by a dead worker.
const sweepIntervalMs = process.env.WORKER_SWEEP_INTERVAL_MS
  ? Number(process.env.WORKER_SWEEP_INTERVAL_MS)
  : 30_000;
// ponytail: if set, exit once no job has been found for this long — lets a
// load test drain a fixed queue and finish; omit for a long-running worker.
const idleExitMs = process.env.WORKER_IDLE_EXIT_MS ? Number(process.env.WORKER_IDLE_EXIT_MS) : null;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sweep() {
  const recovered = await recoverStuckJobs();
  if (recovered) console.log(`${workerId} recovered ${recovered} stuck job(s)`);
}

async function run() {
  await sweep(); // on startup: reclaim anything a previously-crashed worker abandoned
  let lastSweep = Date.now();
  let idleSince: number | null = null;

  for (;;) {
    const job = await claimJob(workerId);
    if (job) {
      idleSince = null;
      const outcome = await runJob(job, workerId);
      console.log(`${workerId} job ${job.id} (${job.node_id}) -> ${outcome}`);
      continue;
    }

    if (Date.now() - lastSweep >= sweepIntervalMs) {
      await sweep();
      lastSweep = Date.now();
    }

    if (idleExitMs !== null) {
      idleSince ??= Date.now();
      if (Date.now() - idleSince >= idleExitMs) break;
    }
    await sleep(pollIntervalMs);
  }
  await pool.end();
}

run().catch((err) => {
  console.error(`${workerId} crashed:`, err);
  process.exit(1);
});
