import { Router } from "express";
import { pool } from "../db/pool.js";
import { startRun } from "../queue/startRun.js";
import { wrap } from "./wrap.js";

export const runs = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Trigger a run of a workflow. Does not execute anything — enqueues the root
// jobs; workers pick them up. Returns the run id to poll.
runs.post("/", wrap(async (req, res) => {
  const workflowId = req.body?.workflow_id;
  if (typeof workflowId !== "string" || !UUID_RE.test(workflowId)) {
    return res.status(400).json({ error: "workflow_id must be a valid uuid" });
  }
  const exists = await pool.query(`SELECT 1 FROM workflows WHERE id = $1`, [workflowId]);
  if (exists.rowCount === 0) return res.status(404).json({ error: "workflow not found" });
  const { runId, enqueued } = await startRun(workflowId);
  res.status(201).json({ run_id: runId, enqueued });
}));

// Run status + the latest event per node (for the builder to light up the DAG)
// + the full event log. Polled by the builder; Phase 6 swaps this for a WS push.
runs.get("/:id", wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: "run not found" });
  const { rows: runRows } = await pool.query(
    `SELECT id, status, started_at, finished_at FROM runs WHERE id = $1`,
    [req.params.id],
  );
  if (runRows.length === 0) return res.status(404).json({ error: "run not found" });

  const { rows: nodeRows } = await pool.query<{ node_id: string; event_type: string }>(
    `SELECT DISTINCT ON (node_id) node_id, event_type
     FROM run_events WHERE run_id = $1
     ORDER BY node_id, id DESC`,
    [req.params.id],
  );
  const nodeStates: Record<string, string> = {};
  for (const r of nodeRows) nodeStates[r.node_id] = r.event_type;

  const { rows: events } = await pool.query(
    `SELECT node_id, event_type, created_at FROM run_events WHERE run_id = $1 ORDER BY id`,
    [req.params.id],
  );

  res.json({ ...runRows[0], node_states: nodeStates, events });
}));
