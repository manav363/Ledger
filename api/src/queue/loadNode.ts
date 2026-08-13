import { pool } from "../db/pool.js";
import type { NodeDefinition } from "../nodes/types.js";

// Resolve a job's node_id to its definition ({ id, type, config }) by reaching
// through run -> workflow -> definition.nodes[]. The queue stores only node_id;
// the shape lives in the workflow JSONB, so execution has a single source.
export async function loadNode(runId: string, nodeId: string): Promise<NodeDefinition> {
  const { rows } = await pool.query<{ node: NodeDefinition }>(
    `SELECT n AS node
     FROM runs r
     JOIN workflows w ON w.id = r.workflow_id
     CROSS JOIN LATERAL jsonb_array_elements(w.definition->'nodes') AS n
     WHERE r.id = $1 AND n->>'id' = $2
     LIMIT 1`,
    [runId, nodeId],
  );
  const node = rows[0]?.node;
  if (!node) throw new Error(`node '${nodeId}' not found in workflow definition for run ${runId}`);
  return node;
}
