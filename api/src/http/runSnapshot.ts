import { pool } from "../db/pool.js";

export interface RunSnapshot {
  id: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  node_states: Record<string, string>;
  events: { node_id: string; event_type: string; created_at: string }[];
}

// Current state of a run: status + the latest event per node + the full log.
// Used by GET /runs/:id and as the initial payload a WS client receives on
// connect (so it starts consistent, then applies live deltas).
export async function runSnapshot(runId: string): Promise<RunSnapshot | null> {
  const { rows: runRows } = await pool.query<{ id: string; status: string; started_at: string | null; finished_at: string | null }>(
    `SELECT id, status, started_at, finished_at FROM runs WHERE id = $1`,
    [runId],
  );
  if (runRows.length === 0) return null;

  const { rows: nodeRows } = await pool.query<{ node_id: string; event_type: string }>(
    `SELECT DISTINCT ON (node_id) node_id, event_type
     FROM run_events WHERE run_id = $1
     ORDER BY node_id, id DESC`,
    [runId],
  );
  const node_states: Record<string, string> = {};
  for (const r of nodeRows) node_states[r.node_id] = r.event_type;

  const { rows: events } = await pool.query<{ node_id: string; event_type: string; created_at: string }>(
    `SELECT node_id, event_type, created_at FROM run_events WHERE run_id = $1 ORDER BY id`,
    [runId],
  );

  return { ...runRows[0], node_states, events };
}
