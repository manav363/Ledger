export interface NodeDefinition {
  id: string;
  type: string;
  config: Record<string, unknown>;
}

export interface NodeContext {
  runId: string;
  attempt: number;
}

export type NodeHandler = (node: NodeDefinition, ctx: NodeContext) => Promise<unknown>;
