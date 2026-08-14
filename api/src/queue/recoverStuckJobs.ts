import { pool } from "../db/pool.js";

// ponytail: a timeout can't distinguish a dead worker from a slow-but-alive one,
// so set this comfortably above your slowest node — too short and a live worker's
// in-flight job gets requeued and runs twice. Read at call time so a demo/test
// can shorten it. Default 2 minutes.
function stuckTimeoutMs(): number {
  return process.env.WORKER_STUCK_TIMEOUT_MS ? Number(process.env.WORKER_STUCK_TIMEOUT_MS) : 120_000;
}

// Requeues jobs claimed longer than the timeout ago that have no matching
// step_completed event — i.e. a worker claimed them and died before finishing.
// The `id NOT IN (completed job_ids)` guard is the safety net: completeJob writes
// status='done' and step_completed in one transaction, so a genuinely finished
// job is never resurrected even if its status somehow read 'claimed'.
export async function recoverStuckJobs(): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE jobs
     SET status = 'queued', claimed_by = NULL, claimed_at = NULL
     WHERE status = 'claimed'
       AND claimed_at < now() - ($1::bigint * interval '1 millisecond')
       AND id NOT IN (
         SELECT (payload->>'job_id')::bigint FROM run_events
         WHERE event_type = 'step_completed'
       )`,
    [stuckTimeoutMs()],
  );
  return rowCount ?? 0;
}
