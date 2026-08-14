import type { RunStatus } from "./api";

type Message =
  | ({ kind: "snapshot"; run_id: string } & Partial<RunStatus>)
  | { kind: "event"; run_id: string; node_id: string; event_type: string }
  | { kind: "status"; run_id: string; status: string };

interface StreamHandlers {
  onSnapshot: (nodeStates: Record<string, string>, status: string) => void;
  onEvent: (nodeId: string, eventType: string) => void;
  onStatus: (status: string) => void;
}

// Live run stream over WebSocket (Postgres LISTEN/NOTIFY on the server side).
// Returns a close function. Replaces the Phase 5 polling.
export function openRunStream(runId: string, handlers: StreamHandlers): () => void {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/api/runs/${runId}/stream`);

  ws.onmessage = (e) => {
    let msg: Message;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    if (msg.kind === "snapshot") handlers.onSnapshot(msg.node_states ?? {}, msg.status ?? "running");
    else if (msg.kind === "event") handlers.onEvent(msg.node_id, msg.event_type);
    else if (msg.kind === "status") handlers.onStatus(msg.status);
  };

  return () => ws.close();
}
