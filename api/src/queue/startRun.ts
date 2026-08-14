import { pool } from "../db/pool.js";
import { loadDefinition, rootsOf } from "../dag/graph.js";

// Starts a run of a workflow: creates the run row and enqueues its root nodes
// (those with no incoming edge). The DAG advances itself from there as each node
// completes. This is what POST /runs will call in Phase 5.
export async function startRun(workflowId: string): Promise<{ runId: string; enqueued: string[] }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [run] } = await client.query<{ id: string }>(
      `INSERT INTO runs (workflow_id, status, started_at) VALUES ($1, 'running', now()) RETURNING id`,
      [workflowId],
    );
    const def = await loadDefinition(client, run.id);
    const roots = rootsOf(def);
    if (def.nodes.length > 0 && roots.length === 0) {
      throw new Error(`workflow ${workflowId} has no root nodes (cycle?)`);
    }
    const enqueued: string[] = [];
    for (const root of roots) {
      await client.query(
        `INSERT INTO jobs (run_id, node_id) VALUES ($1, $2)
         ON CONFLICT (run_id, node_id) DO NOTHING`,
        [run.id, root.id],
      );
      enqueued.push(root.id);
    }
    await client.query("COMMIT");
    return { runId: run.id, enqueued };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
