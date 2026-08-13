import type { NodeHandler } from "./types.js";

// A node that does nothing and completes — used by the concurrency load test so
// it exercises the real execution path without any side effects or network I/O.
export const noopNode: NodeHandler = async (node) => {
  return { node_id: node.id };
};
