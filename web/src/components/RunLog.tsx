import { useEffect, useRef } from "react";
import type { LogEntry } from "../lib/runStream";

const EVENT_CLASS: Record<string, string> = {
  step_started: "log__row--started",
  retry: "log__row--retry",
  step_completed: "log__row--done",
  step_failed: "log__row--failed",
};

const LABEL: Record<string, string> = {
  step_started: "started",
  retry: "retry",
  step_completed: "completed",
  step_failed: "failed",
};

function time(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour12: false });
}

interface RunLogProps {
  events: LogEntry[];
}

// Live event stream for the current run — makes retries and failures visible as
// they happen (the retry/backoff UI): a node flashing retry → retry → failed
// reads straight off this log.
export function RunLog({ events }: RunLogProps) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [events.length]);

  return (
    <div className="log">
      <h2 className="panel__title">Run log</h2>
      {events.length === 0 ? (
        <p className="log__empty">Events stream here live as a run executes.</p>
      ) : (
        <div className="log__list">
          {events.map((e, i) => (
            <div key={i} className={`log__row ${EVENT_CLASS[e.event_type] ?? ""}`}>
              <span className="log__time">{time(e.created_at)}</span>
              <span className="log__node">{e.node_id}</span>
              <span className="log__event">{LABEL[e.event_type] ?? e.event_type}</span>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}
