import type { NodeHandler } from "./types.js";

// A delay node — waits config.ms then completes. Genuinely useful (throttling,
// scheduled waits) and gives the crash-recovery demo a reliable window to kill a
// worker mid-execution: step_started is written, then the node sits here.
export const sleepNode: NodeHandler = async (node) => {
  const ms = typeof node.config.ms === "number" ? node.config.ms : 0;
  await new Promise((resolve) => setTimeout(resolve, ms));
  return { slept_ms: ms };
};
