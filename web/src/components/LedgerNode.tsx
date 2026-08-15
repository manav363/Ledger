import { Handle, Position, type NodeProps } from "@xyflow/react";
import { specFor } from "../lib/nodeSpecs";
import type { LedgerNode as LedgerNodeType } from "../lib/graph";

const STATUS_CLASS: Record<string, string> = {
  step_started: "running",
  retry: "retry",
  step_completed: "done",
  step_failed: "failed",
};

const STATUS_LABEL: Record<string, string> = {
  step_started: "running",
  retry: "retrying",
  step_completed: "completed",
  step_failed: "failed",
};

function summarize(nodeType: string, config: Record<string, unknown>): string {
  if (nodeType === "http") return `${(config.method as string) ?? "GET"} ${(config.url as string) ?? "—"}`;
  if (nodeType === "sleep") return `${(config.ms as number) ?? 0} ms`;
  if (nodeType === "noop" && config.emit !== undefined) return `emit ${JSON.stringify(config.emit)}`;
  return "";
}

export function LedgerNode({ id, data, selected }: NodeProps<LedgerNodeType>) {
  const spec = specFor(data.nodeType);
  const summary = summarize(data.nodeType, data.config);
  const statusClass = data.status ? STATUS_CLASS[data.status] ?? "" : "";
  const statusLabel = data.status ? STATUS_LABEL[data.status] : undefined;

  return (
    <div
      className={`node ${selected ? "node--selected" : ""} ${statusClass ? `node--${statusClass}` : ""}`}
      style={{ ["--accent" as string]: `var(${spec?.accent ?? "--node-noop"})` }}
    >
      <Handle type="target" position={Position.Top} />
      <div className="node__head">
        <span className="node__label">{spec?.label ?? data.nodeType}</span>
        <span className="node__dot" />
      </div>
      <div className="node__id">{id}</div>
      {summary && <div className="node__summary">{summary}</div>}
      {statusLabel && <div className="node__status">{statusLabel}</div>}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
