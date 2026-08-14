import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { subscribe, unsubscribe } from "./liveEvents.js";
import { runSnapshot } from "./runSnapshot.js";

const STREAM_RE = /^\/api\/runs\/([0-9a-f-]{36})\/stream$/i;

// Attaches a WebSocket endpoint at /api/runs/:id/stream. On connect the client
// gets a snapshot, then live event/status deltas relayed from Postgres NOTIFY.
export function attachWs(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const match = req.url ? STREAM_RE.exec(req.url) : null;
    if (!match) {
      socket.destroy();
      return;
    }
    const runId = match[1];
    wss.handleUpgrade(req, socket, head, (ws) => onConnect(ws, runId));
  });
}

async function onConnect(ws: WebSocket, runId: string): Promise<void> {
  subscribe(runId, ws);
  ws.on("close", () => unsubscribe(runId, ws));
  ws.on("error", () => unsubscribe(runId, ws));

  try {
    const snapshot = await runSnapshot(runId);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ kind: "snapshot", run_id: runId, ...snapshot }));
    }
  } catch (err) {
    console.error("[wsServer] snapshot failed:", err instanceof Error ? err.message : err);
  }
}
