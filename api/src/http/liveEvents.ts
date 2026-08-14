import { Client } from "pg";
import type { WebSocket } from "ws";

// runId -> connected sockets watching that run.
const subscribers = new Map<string, Set<WebSocket>>();

export function subscribe(runId: string, ws: WebSocket): void {
  let set = subscribers.get(runId);
  if (!set) subscribers.set(runId, (set = new Set()));
  set.add(ws);
}

export function unsubscribe(runId: string, ws: WebSocket): void {
  const set = subscribers.get(runId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) subscribers.delete(runId);
}

function dispatch(payload: string): void {
  let msg: { run_id?: string };
  try {
    msg = JSON.parse(payload);
  } catch {
    return; // malformed notification — ignore
  }
  if (!msg.run_id) return;
  const set = subscribers.get(msg.run_id);
  if (!set) return;
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}

// A single dedicated connection (not from the pool — LISTEN is session-scoped and
// pools recycle connections, silently dropping the subscription). Reconnects on
// error so a dropped DB connection doesn't kill the live view permanently.
// Returns a stop() that closes the connection and halts reconnection.
export function startLiveEvents(): () => Promise<void> {
  let current: Client | null = null;
  let stopped = false;

  const connect = () => {
    if (stopped) return;
    const client = new Client({
      connectionString: process.env.DATABASE_URL ?? "postgres://localhost:5432/ledger_dev",
    });
    current = client;
    client.on("notification", (n) => n.payload && dispatch(n.payload));
    client.on("error", (err) => {
      if (stopped) return;
      console.error("[liveEvents] LISTEN connection error, reconnecting:", err.message);
      client.end().catch(() => {});
      setTimeout(connect, 1000);
    });
    client
      .connect()
      .then(() => client.query("LISTEN ledger"))
      .then(() => console.log("[liveEvents] listening on channel 'ledger'"))
      .catch((err) => {
        if (stopped) return;
        console.error("[liveEvents] failed to connect, retrying:", err.message);
        setTimeout(connect, 1000);
      });
  };
  connect();

  return async () => {
    stopped = true;
    await current?.end().catch(() => {});
  };
}
