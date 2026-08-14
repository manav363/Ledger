import type { NodeHandler } from "./types.js";

// Does nothing, completes, and echoes back what it saw — used by the concurrency
// load test (side-effect-free execution) and the DAG tests (branch on `value`,
// verify `input` was threaded from upstream). `config.emit` becomes output.value.
export const noopNode: NodeHandler = async (node, ctx) => {
  const out: Record<string, unknown> = { node_id: node.id };
  if (node.config.emit !== undefined) out.value = node.config.emit;
  if (Object.keys(ctx.input).length > 0) out.input = ctx.input;
  return out;
};
