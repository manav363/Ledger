import type { Node, Edge } from "@xyflow/react";
import type { EdgeCondition, WorkflowDefinition } from "./api";

export interface LedgerNodeData extends Record<string, unknown> {
  nodeType: string;
  config: Record<string, unknown>;
  status?: string; // latest run event_type, drives node color during a run
}
export interface LedgerEdgeData extends Record<string, unknown> {
  when?: EdgeCondition;
}

export type LedgerNode = Node<LedgerNodeData>;
export type LedgerEdge = Edge<LedgerEdgeData>;

// ReactFlow graph -> API workflow definition (positions are persisted so the
// layout survives a reload).
export function toDefinition(nodes: LedgerNode[], edges: LedgerEdge[]): WorkflowDefinition {
  return {
    nodes: nodes.map((n) => ({ id: n.id, type: n.data.nodeType, config: n.data.config, position: n.position })),
    edges: edges.map((e) => ({ from: e.source, to: e.target, ...(e.data?.when ? { when: e.data.when } : {}) })),
  };
}

export function fromDefinition(def: WorkflowDefinition): { nodes: LedgerNode[]; edges: LedgerEdge[] } {
  return {
    nodes: def.nodes.map((n, i) => ({
      id: n.id,
      type: "ledger",
      position: n.position ?? { x: 120, y: 80 + i * 130 },
      data: { nodeType: n.type, config: n.config ?? {} },
    })),
    edges: def.edges.map((e) => ({
      id: `${e.from}->${e.to}`,
      source: e.from,
      target: e.to,
      data: e.when ? { when: e.when } : {},
    })),
  };
}

export function nextNodeId(existing: LedgerNode[], type: string): string {
  let k = 1;
  const ids = new Set(existing.map((n) => n.id));
  while (ids.has(`${type}-${k}`)) k++;
  return `${type}-${k}`;
}
