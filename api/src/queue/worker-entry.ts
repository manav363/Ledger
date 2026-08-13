import { claimJob } from "./claimJob.js";
import { runJob } from "./runJob.js";
import { pool } from "../db/pool.js";

const workerId = process.argv[2] ?? `worker-${process.pid}`;
const pollIntervalMs = 20;
// ponytail: if set, exit once no job has been found for this long — lets a
// load test drain a fixed queue and finish; omit for a long-running worker.
const idleExitMs = process.env.WORKER_IDLE_EXIT_MS ? Number(process.env.WORKER_IDLE_EXIT_MS) : null;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  let idleSince: number | null = null;
  for (;;) {
    const job = await claimJob(workerId);
    if (job) {
      idleSince = null;
      const outcome = await runJob(job, workerId);
      console.log(`${workerId} job ${job.id} (${job.node_id}) -> ${outcome}`);
      continue;
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
