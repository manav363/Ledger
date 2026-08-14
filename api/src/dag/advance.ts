import type { PoolClient } from "pg";
import type { WorkflowDefinition } from "./types.js";
import { loadDefinition, loadCompletedOutputs, parentsOf } from "./graph.js";
import { evaluateCondition } from "./condition.js";

// A target is ready when every parent has completed AND every conditional
// incoming edge evaluates true against that parent's output. A false condition
// means the branch was not taken, so the target is never enqueued.
//
// ponytail: known ceiling — a join *after* a conditional branch (diamond where
// one arm is skipped) will never fire, because the skipped arm's parent never
// completes. Handling that needs dead-path elimination; out of scope for Phase 3.
function isReady(def: WorkflowDefinition, target: string, outputs: Map<string, unknown>): boolean {
  const incoming = parentsOf(def, target);
  if (incoming.length === 0) return false; // a root — started at run start, not here
  for (const edge of incoming) {
    if (!outputs.has(edge.from)) return false;
    if (edge.when && !evaluateCondition(outputs.get(edge.from), edge.when)) return false;
  }
  return true;
}

// Called inside completeJob's transaction, under a per-run advisory lock, after
// the step_completed row is inserted. Enqueues any successor whose dependencies
// are now satisfied. Returns the node ids actually enqueued.
export async function advanceDag(
  client: PoolClient,
  runId: string,
  completedNodeId: string,
): Promise<string[]> {
  const def = await loadDefinition(client, runId);
  const outputs = await loadCompletedOutputs(client, runId);

  const successors = [...new Set(def.edges.filter((e) => e.from === completedNodeId).map((e) => e.to))];
  const enqueued: string[] = [];
  for (const target of successors) {
    if (!isReady(def, target, outputs)) continue;
    const res = await client.query(
      `INSERT INTO jobs (run_id, node_id) VALUES ($1, $2)
       ON CONFLICT (run_id, node_id) DO NOTHING`,
      [runId, target],
    );
    if (res.rowCount) enqueued.push(target);
  }
  return enqueued;
}
