# Project brief: durable workflow automation engine

## What this is

A visual workflow automation tool (like n8n/Zapier) where you drag-connect
nodes into a DAG (webhook trigger → HTTP call → condition → email, etc.)
and run it. The differentiator from a typical clone: **crash-safe
execution**. If the server or a worker process dies mid-run, the workflow
resumes from the last completed step instead of losing the run or
double-executing steps.

Stack: React (frontend) + Node.js/Express (API) + PostgreSQL (single
source of truth, no external queue library).

## Why this is hard (the actual grading/demo hook)

1. **Event-sourced execution** — state isn't stored as "current status: X."
   Every step transition is appended as an immutable event row. Current
   state is *derived* by replaying events, not trusted from memory.
2. **Exactly-once-ish step execution under crashes** — a worker can die
   mid-step. On restart, another worker must be able to tell "was this
   step actually finished?" purely from Postgres, and safely retry only
   what wasn't.
3. **Concurrency-safe job claiming** — multiple worker processes polling
   the same queue table must never grab the same job twice. This is a
   `SELECT ... FOR UPDATE SKIP LOCKED` problem, not an in-memory lock.
4. **Live state over WebSocket** — the frontend reflects DB state changes
   in real time without polling.

## Architecture

```
React app (builder + live view)
        │  save workflow / trigger run
        ▼
Express API  ──persist──▶  Postgres (workflows, job queue, event log)
        ▲                          │
        │ WebSocket push           │ poll for next job
        │                          ▼
        └──────────────────  Worker pool
                             (executes node, writes
                              event, releases job)
```

- **React app**: DAG builder (nodes + edges), a "run" trigger, and a live
  view subscribed over WebSocket that highlights nodes as they execute.
- **Express API**: CRUD for workflow definitions, an endpoint to enqueue a
  run, and a WebSocket layer that broadcasts events as they land in
  Postgres.
- **Postgres**: the entire coordination layer. No Redis, no external
  queue — the point of the project is proving you can build durable
  execution on plain Postgres.
- **Worker pool**: one or more Node processes polling for claimable jobs,
  executing a node's logic (HTTP call, condition eval, delay, etc.),
  writing the result as an event, and picking up the next job.

## Database schema (starting point)

```sql
-- workflow definitions (the DAG itself)
CREATE TABLE workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  definition JSONB NOT NULL,   -- nodes + edges, versioned
  created_at TIMESTAMPTZ DEFAULT now()
);

-- one row per execution of a workflow
CREATE TABLE runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES workflows(id),
  status TEXT NOT NULL DEFAULT 'pending', -- pending/running/completed/failed
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

-- append-only event log — the actual source of truth
CREATE TABLE run_events (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID REFERENCES runs(id),
  node_id TEXT NOT NULL,
  event_type TEXT NOT NULL,   -- step_started/step_completed/step_failed/retry
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- the job queue — what workers poll
CREATE TABLE jobs (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID REFERENCES runs(id),
  node_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', -- queued/claimed/done/failed
  attempts INT NOT NULL DEFAULT 0,
  claimed_by TEXT,             -- worker id
  claimed_at TIMESTAMPTZ,
  available_at TIMESTAMPTZ DEFAULT now()  -- supports backoff/retry delay
);
```

**Claiming a job safely (the core trick):**

```sql
UPDATE jobs
SET status = 'claimed', claimed_by = $1, claimed_at = now(), attempts = attempts + 1
WHERE id = (
  SELECT id FROM jobs
  WHERE status = 'queued' AND available_at <= now()
  ORDER BY id
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING *;
```

`FOR UPDATE SKIP LOCKED` is what makes concurrent workers safe — a worker
that's already locking a row is invisible to other workers' SELECT, so
two workers can never claim the same job.

**Resuming after a crash:** on worker startup (or via a periodic sweep),
find jobs stuck in `claimed` for longer than a timeout with no matching
`step_completed` event — those get reset to `queued` and picked up again.

## Suggested build order (semester-length, solo)

1. **Weeks 1–2 — schema + job claiming**: get the tables above working,
   write a script that spins up 5 fake workers hammering the same queue,
   prove zero double-claims.
2. **Weeks 3–4 — single-node execution**: hardcode one node type (HTTP
   call), get a job → execute → event → job marked done working
   end-to-end, no UI yet.
3. **Weeks 5–6 — DAG execution**: chain multiple nodes, handle
   branching/conditions, enqueue the next job only after the previous
   one's completion event exists.
4. **Weeks 7–8 — crash recovery**: kill a worker mid-execution on
   purpose, prove the run resumes correctly without re-running completed
   steps or losing the crashed one.
5. **Weeks 9–10 — React builder**: drag-and-drop node canvas, save/load
   workflow JSON to the API.
6. **Weeks 11–12 — live view**: WebSocket event stream, nodes light up as
   they execute in the UI.
7. **Weeks 13–14 — polish + demo**: retry/backoff UI, a live load-test
   demo (kill a worker on stage, show the run recovers), README with
   architecture diagram.

## Stretch goals (if time allows)

- Conditional/branching nodes and parallel fan-out execution
- Per-node retry policy with exponential backoff
- Workflow versioning (edit a workflow without breaking in-flight runs)
- Scheduled/cron-triggered runs