import { Router } from "express";
import { pool } from "../db/pool.js";
import { validateDefinition } from "./validate.js";
import { wrap } from "./wrap.js";

export const workflows = Router();

// List (newest first) — powers the "open" menu and the Workflows screen, so it
// carries node count and the latest run's status/time per workflow.
workflows.get("/", wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT w.id, w.name, w.created_at,
            COALESCE(jsonb_array_length(w.definition->'nodes'), 0) AS node_count,
            lr.status AS last_status, lr.started_at AS last_run_at
     FROM workflows w
     LEFT JOIN LATERAL (
       SELECT status, started_at FROM runs r
       WHERE r.workflow_id = w.id
       ORDER BY r.started_at DESC NULLS LAST, r.id DESC
       LIMIT 1
     ) lr ON true
     ORDER BY w.created_at DESC`,
  );
  res.json(rows);
}));

workflows.get("/:id", wrap(async (req, res) => {
  const { rows } = await pool.query(`SELECT id, name, definition, created_at FROM workflows WHERE id = $1`, [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: "workflow not found" });
  res.json(rows[0]);
}));

workflows.post("/", wrap(async (req, res) => {
  const name = typeof req.body?.name === "string" && req.body.name.trim() ? req.body.name.trim() : "Untitled workflow";
  const { errors, definition } = validateDefinition(req.body?.definition);
  if (errors.length > 0) return res.status(400).json({ errors });
  const { rows } = await pool.query(
    `INSERT INTO workflows (name, definition) VALUES ($1, $2) RETURNING id, name, definition, created_at`,
    [name, JSON.stringify(definition)],
  );
  res.status(201).json(rows[0]);
}));

workflows.put("/:id", wrap(async (req, res) => {
  const { errors, definition } = validateDefinition(req.body?.definition);
  if (errors.length > 0) return res.status(400).json({ errors });
  const name = typeof req.body?.name === "string" && req.body.name.trim() ? req.body.name.trim() : "Untitled workflow";
  const { rows } = await pool.query(
    `UPDATE workflows SET name = $2, definition = $3 WHERE id = $1 RETURNING id, name, definition, created_at`,
    [req.params.id, name, JSON.stringify(definition)],
  );
  if (rows.length === 0) return res.status(404).json({ error: "workflow not found" });
  res.json(rows[0]);
}));
