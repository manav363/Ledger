import { pool } from "../db/pool.js";
import type { Job } from "./claimJob.js";

export async function completeJob(job: Job, output: unknown): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
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
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
