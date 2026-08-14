// Typed fetch helpers for the Ledger API (proxied to :3001 by Vite).

export interface EdgeCondition {
  path: string;
  op: string;
  value?: unknown;
}
export interface WfNode {
  id: string;
  type: string;
  config: Record<string, unknown>;
  position?: { x: number; y: number };
}
export interface WfEdge {
  from: string;
  to: string;
  when?: EdgeCondition;
}
export interface WorkflowDefinition {
  nodes: WfNode[];
  edges: WfEdge[];
}
export interface Workflow {
  id: string;
  name: string;
  definition: WorkflowDefinition;
  created_at: string;
}
export interface WorkflowSummary {
  id: string;
  name: string;
  created_at: string;
}
export interface RunStatus {
  id: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  node_states: Record<string, string>;
  events: { node_id: string; event_type: string; created_at: string }[];
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = body.errors ? body.errors.join("; ") : body.error ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listWorkflows: () => fetch("/api/workflows").then(json<WorkflowSummary[]>),
  getWorkflow: (id: string) => fetch(`/api/workflows/${id}`).then(json<Workflow>),
  createWorkflow: (name: string, definition: WorkflowDefinition) =>
    fetch("/api/workflows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, definition }),
    }).then(json<Workflow>),
  updateWorkflow: (id: string, name: string, definition: WorkflowDefinition) =>
    fetch(`/api/workflows/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, definition }),
    }).then(json<Workflow>),
  startRun: (workflowId: string) =>
    fetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workflow_id: workflowId }),
    }).then(json<{ run_id: string; enqueued: string[] }>),
  getRun: (id: string) => fetch(`/api/runs/${id}`).then(json<RunStatus>),
};
