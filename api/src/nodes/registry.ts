import type { NodeDefinition, NodeContext, NodeHandler } from "./types.js";
import { httpNode } from "./http.js";
import { noopNode } from "./noop.js";

// The pluggable seam: adding a node type is one entry here, no queue/event
// changes. Keep handlers pure w.r.t. the queue — they take a node + context and
// return output; the caller owns event-writing and job state.
const handlers: Record<string, NodeHandler> = {
  http: httpNode,
  noop: noopNode,
};

export async function executeNode(node: NodeDefinition, ctx: NodeContext): Promise<unknown> {
  const handler = handlers[node.type];
  if (!handler) throw new Error(`no handler registered for node type '${node.type}'`);
  return handler(node, ctx);
}
