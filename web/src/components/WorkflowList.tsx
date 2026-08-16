import type { WorkflowSummary } from "../lib/api";
import { timeAgo } from "../lib/time";

const STATUS_COLOR: Record<string, string> = {
  running: "var(--run-running)",
  completed: "var(--run-completed)",
  failed: "var(--run-failed)",
  pending: "var(--run-queued)",
};

interface WorkflowListProps {
  workflows: WorkflowSummary[];
  onOpen: (id: string) => void;
  onNew: () => void;
}

export function WorkflowList({ workflows, onOpen, onNew }: WorkflowListProps) {
  return (
    <div className="wl">
      <div className="wl__head">
        <div>
          <div className="wl__title">Workflows</div>
          <div className="wl__sub">{workflows.length} saved {workflows.length === 1 ? "definition" : "definitions"}</div>
        </div>
        <button className="btn" onClick={onNew}>+ New workflow</button>
      </div>

      <div className="wl__table">
        <div className="wl__row wl__row--head">
          <span>Name</span><span>ID</span><span>Nodes</span><span>Last run</span><span>Updated</span>
        </div>
        {workflows.length === 0 && <div className="wl__empty">No workflows yet — create one to get started.</div>}
        {workflows.map((w) => {
          const color = w.last_status ? STATUS_COLOR[w.last_status] ?? "var(--run-queued)" : "var(--text-faint)";
          return (
            <div key={w.id} className="wl__row" onClick={() => onOpen(w.id)}>
              <span className="wl__name">{w.name}</span>
              <span className="wl__mono">{w.id.slice(0, 8)}</span>
              <span className="wl__mono wl__dim">{w.node_count}</span>
              <span className="wl__status">
                <span className="wl__dot" style={{ background: color }} />
                <span className="wl__mono" style={{ color }}>{w.last_status ?? "never run"}</span>
              </span>
              <span className="wl__mono wl__dim">{timeAgo(w.last_run_at ?? w.created_at)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
