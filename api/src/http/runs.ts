import { Router } from "express";
import { pool } from "../db/pool.js";
import { startRun } from "../queue/startRun.js";
import { runSnapshot } from "./runSnapshot.js";
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

// Run status + latest event per node + full log. Still handy for a one-shot
// fetch; the live builder now streams over WS (see wsServer/liveEvents).
runs.get("/:id", wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: "run not found" });
  const snapshot = await runSnapshot(req.params.id);
  if (!snapshot) return res.status(404).json({ error: "run not found" });
  res.json(snapshot);
}));
