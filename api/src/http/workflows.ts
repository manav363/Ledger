import { Router } from "express";
import { pool } from "../db/pool.js";
import { validateDefinition } from "./validate.js";
import { wrap } from "./wrap.js";

export const workflows = Router();

// List (newest first) — for the builder's "open" menu.
workflows.get("/", wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, created_at FROM workflows ORDER BY created_at DESC`,
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
