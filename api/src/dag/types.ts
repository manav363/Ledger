import type { NodeDefinition } from "../nodes/types.js";

export type ConditionOp = "eq" | "ne" | "lt" | "lte" | "gt" | "gte" | "truthy" | "falsy";

// A condition evaluated against the *source* node's output when deciding whether
// to traverse an edge. `path` is a dot-path into that output ("" = whole value).
export interface EdgeCondition {
  path: string;
  op: ConditionOp;
  value?: unknown;
}

export interface Edge {
  from: string;
  to: string;
  when?: EdgeCondition;
}

export interface WorkflowDefinition {
  nodes: NodeDefinition[];
  edges: Edge[];
}
