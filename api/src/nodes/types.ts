export interface NodeDefinition {
  id: string;
  type: string;
  config: Record<string, unknown>;
}

export interface NodeContext {
  runId: string;
  attempt: number;
  // Upstream outputs keyed by parent node id (empty for root nodes).
  input: Record<string, unknown>;
}

export type NodeHandler = (node: NodeDefinition, ctx: NodeContext) => Promise<unknown>;
