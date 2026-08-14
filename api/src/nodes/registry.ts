import type { NodeDefinition, NodeContext, NodeHandler } from "./types.js";
import { httpNode } from "./http.js";
import { noopNode } from "./noop.js";
import { sleepNode } from "./sleep.js";

// The pluggable seam: adding a node type is one entry here, no queue/event
// changes. Keep handlers pure w.r.t. the queue — they take a node + context and
// return output; the caller owns event-writing and job state.
// Idempotency per node type (the honest "exactly-once-ish" statement): a crash
// mid-node re-runs that node, so a non-idempotent side effect can repeat.
//   noop, sleep — idempotent (no external effect), safe to re-run.
//   http       — NOT idempotent for non-idempotent methods (a POST can double);
//                at-least-once. An idempotency-key option is the future fix.
// Completed nodes are never re-run — only the in-flight node at crash time is.
const handlers: Record<string, NodeHandler> = {
  http: httpNode,
  noop: noopNode,
  sleep: sleepNode,
};

export const nodeTypes = Object.keys(handlers);

export async function executeNode(node: NodeDefinition, ctx: NodeContext): Promise<unknown> {
  const handler = handlers[node.type];
  if (!handler) throw new Error(`no handler registered for node type '${node.type}'`);
  return handler(node, ctx);
}
