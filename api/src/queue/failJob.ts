import { pool } from "../db/pool.js";
import type { Job } from "./claimJob.js";
import { refreshRunStatus } from "./runStatus.js";

const MAX_ATTEMPTS = 3;

// ponytail: fixed base with exponential backoff; env override keeps tests fast.
// Read at call time (not module load) so the value isn't frozen before a caller
// can set it. Per-node retry policy is a Phase 7 stretch goal.
function backoffBaseMs(): number {
  return process.env.WORKER_BACKOFF_MS ? Number(process.env.WORKER_BACKOFF_MS) : 1000;
}

// Records the failure as an event and decides retry-vs-give-up. attempts was
// already incremented by the claim, so attempt 1 and 2 requeue with backoff and
// attempt 3 (== MAX_ATTEMPTS) marks the job failed. Returns whether it requeued.
export async function failJob(job: Job, error: Error): Promise<boolean> {
  const willRetry = job.attempts < MAX_ATTEMPTS;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`, [job.run_id]);
    await client.query(
      `INSERT INTO run_events (run_id, node_id, event_type, payload)
       VALUES ($1, $2, $3, $4)`,
      [
        job.run_id,
        job.node_id,
        willRetry ? "retry" : "step_failed",
        JSON.stringify({ job_id: job.id, attempt: job.attempts, error: error.message }),
      ],
    );
    if (willRetry) {
      const delayMs = backoffBaseMs() * 2 ** (job.attempts - 1);
      await client.query(
        `UPDATE jobs
         SET status = 'queued', claimed_by = NULL, claimed_at = NULL,
             available_at = now() + ($2::int * interval '1 millisecond')
         WHERE id = $1`,
        [job.id, delayMs],
      );
    } else {
      await client.query(`UPDATE jobs SET status = 'failed' WHERE id = $1`, [job.id]);
    }
    await refreshRunStatus(client, job.run_id);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return willRetry;
}
