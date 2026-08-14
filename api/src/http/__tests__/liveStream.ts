import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { pool } from "../../db/pool.js";
import { createApp } from "../app.js";
import { attachWs } from "../wsServer.js";
import { startLiveEvents } from "../liveEvents.js";
import { startRun } from "../../queue/startRun.js";
import { claimJob } from "../../queue/claimJob.js";
import { runJob } from "../../queue/runJob.js";
import type { WorkflowDefinition } from "../../dag/types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(check: () => boolean, timeoutMs: number, label: string) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return;
    await sleep(20);
  }
  throw new Error(`timed out waiting for: ${label}`);
}

interface StreamMsg {
  kind: string;
  node_id?: string;
  event_type?: string;
  status?: string;
}

test("live stream: WS receives a snapshot, per-node events, and the terminal status", async () => {
  const server = http.createServer(createApp());
  attachWs(server);
  const stopLive = startLiveEvents();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  await sleep(300); // let the LISTEN connection come up

  const def: WorkflowDefinition = {
    nodes: [
      { id: "A", type: "noop", config: {} },
      { id: "B", type: "noop", config: {} },
    ],
    edges: [{ from: "A", to: "B" }],
  };
  const { rows: [wf] } = await pool.query<{ id: string }>(
    `INSERT INTO workflows (name, definition) VALUES ('livetest', $1) RETURNING id`,
    [JSON.stringify(def)],
  );
  const { runId } = await startRun(wf.id);

  const messages: StreamMsg[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/runs/${runId}/stream`);
  ws.on("message", (d) => messages.push(JSON.parse(d.toString())));
  await new Promise<void>((res, rej) => {
    ws.on("open", () => res());
    ws.on("error", rej);
  });
  await sleep(100); // receive the snapshot

  try {
    // Drive the run in-process (a worker would normally do this).
    for (let i = 0; i < 50; i++) {
      const job = await claimJob("live-worker");
      if (job) {
        await runJob(job, "live-worker");
        continue;
      }
      const { rows: [r] } = await pool.query<{ status: string }>(`SELECT status FROM runs WHERE id = $1`, [runId]);
      if (r.status === "completed" || r.status === "failed") break;
      await sleep(20);
    }

    await waitFor(() => messages.some((m) => m.kind === "status" && m.status === "completed"), 4000, "completed status over WS");

    assert.ok(messages.some((m) => m.kind === "snapshot"), "received a snapshot on connect");
    assert.ok(
      messages.some((m) => m.kind === "event" && m.node_id === "A" && m.event_type === "step_completed"),
      "received A's step_completed as a live event",
    );
    assert.ok(
      messages.some((m) => m.kind === "event" && m.node_id === "B" && m.event_type === "step_completed"),
      "received B's step_completed as a live event",
    );
    assert.ok(messages.some((m) => m.kind === "status" && m.status === "completed"), "received the terminal status");
  } finally {
    ws.close();
    await stopLive();
    await new Promise<void>((res) => server.close(() => res()));
    await pool.query(`DELETE FROM run_events WHERE run_id = $1`, [runId]);
    await pool.query(`DELETE FROM jobs WHERE run_id = $1`, [runId]);
    await pool.query(`DELETE FROM runs WHERE id = $1`, [runId]);
    await pool.query(`DELETE FROM workflows WHERE id = $1`, [wf.id]);
    await pool.end();
  }
});
