import type { Pool, PoolClient } from "pg";
import type { NodeDefinition } from "../nodes/types.js";
import type { Edge, WorkflowDefinition } from "./types.js";

// Either the pool or an in-transaction client — advanceDag passes its client so
// it sees the step_completed it just inserted; read paths can pass the pool.
export type Queryable = Pool | PoolClient;

export async function loadDefinition(q: Queryable, runId: string): Promise<WorkflowDefinition> {
  const { rows } = await q.query<{ definition: WorkflowDefinition }>(
    `SELECT w.definition FROM runs r JOIN workflows w ON w.id = r.workflow_id WHERE r.id = $1`,
    [runId],
  );
  const def = rows[0]?.definition;
  if (!def) throw new Error(`no workflow definition for run ${runId}`);
  return { nodes: def.nodes ?? [], edges: def.edges ?? [] };
}

export function parentsOf(def: WorkflowDefinition, nodeId: string): Edge[] {
  return def.edges.filter((e) => e.to === nodeId);
}

export function rootsOf(def: WorkflowDefinition): NodeDefinition[] {
  const hasIncoming = new Set(def.edges.map((e) => e.to));
  return def.nodes.filter((n) => !hasIncoming.has(n.id));
}

// Latest step_completed output per node for a run, as a Map<nodeId, output>.
export async function loadCompletedOutputs(q: Queryable, runId: string): Promise<Map<string, unknown>> {
  const { rows } = await q.query<{ node_id: string; output: unknown }>(
    `SELECT DISTINCT ON (node_id) node_id, payload->'output' AS output
     FROM run_events
     WHERE run_id = $1 AND event_type = 'step_completed'
     ORDER BY node_id, id DESC`,
    [runId],
  );
  return new Map(rows.map((r) => [r.node_id, r.output]));
}

// A node's input = its parents' outputs, keyed by parent node id. Empty for roots.
export async function gatherInputs(q: Queryable, runId: string, nodeId: string): Promise<Record<string, unknown>> {
  const def = await loadDefinition(q, runId);
  const parents = parentsOf(def, nodeId).map((e) => e.from);
  if (parents.length === 0) return {};
  const outputs = await loadCompletedOutputs(q, runId);
  const input: Record<string, unknown> = {};
  for (const p of parents) {
    if (outputs.has(p)) input[p] = outputs.get(p);
  }
  return input;
}
