import { pool } from "../db/pool.js";

export interface Job {
  id: number;
  run_id: string;
  node_id: string;
  status: string;
  attempts: number;
  claimed_by: string | null;
  claimed_at: string | null;
  available_at: string;
}

export async function claimJob(workerId: string): Promise<Job | null> {
  const { rows } = await pool.query<Job>(
    `UPDATE jobs
     SET status = 'claimed', claimed_by = $1, claimed_at = now(), attempts = attempts + 1
     WHERE id = (
       SELECT id FROM jobs
       WHERE status = 'queued' AND available_at <= now()
       ORDER BY id
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING *`,
    [workerId],
  );
  return rows[0] ?? null;
}
