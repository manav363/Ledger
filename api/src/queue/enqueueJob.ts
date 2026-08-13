import { pool } from "../db/pool.js";

export async function enqueueJob(runId: string, nodeId: string): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO jobs (run_id, node_id) VALUES ($1, $2) RETURNING id`,
    [runId, nodeId],
  );
  return rows[0].id;
}
