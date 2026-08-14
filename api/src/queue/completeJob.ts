import { pool } from "../db/pool.js";
import type { Job } from "./claimJob.js";
import { advanceDag } from "../dag/advance.js";
import { refreshRunStatus } from "./runStatus.js";

// Marks the job done, records step_completed (with the node's output), then
// advances the DAG — all atomically. A per-run advisory lock serializes
// completions within a run so concurrent fan-in completers both see each other's
// committed events and a join node is enqueued exactly once.
export async function completeJob(job: Job, output: unknown): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`, [job.run_id]);
    await client.query(`UPDATE jobs SET status = 'done' WHERE id = $1`, [job.id]);
    await client.query(
      `INSERT INTO run_events (run_id, node_id, event_type, payload)
       VALUES ($1, $2, 'step_completed', $3)`,
      [
        job.run_id,
        job.node_id,
        JSON.stringify({ job_id: job.id, claimed_by: job.claimed_by, output }),
      ],
    );
    await advanceDag(client, job.run_id, job.node_id);
    await refreshRunStatus(client, job.run_id);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
