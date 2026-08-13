import { pool } from "../db/pool.js";

const STUCK_TIMEOUT = "2 minutes";

export async function recoverStuckJobs(): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE jobs
     SET status = 'queued', claimed_by = NULL
     WHERE status = 'claimed'
       AND claimed_at < now() - interval '${STUCK_TIMEOUT}'
       AND id NOT IN (
         SELECT (payload->>'job_id')::bigint FROM run_events
         WHERE event_type = 'step_completed'
       )`,
  );
  return rowCount ?? 0;
}
