# Ledger — a crash-durable workflow automation engine

> Working name: **Ledger** (swap freely — search/replace it if you pick
> something else). Named after the append-only event log that is the
> core idea of the whole project.

Stack: **React** (frontend) + **Node.js/Express** (API + workers) +
**PostgreSQL** (single source of truth — no Redis, no external queue).

---

## 1. Vision

Most "build your own automation tool" student projects are Zapier/n8n
clones that work fine in a demo and quietly fall apart the moment the
server restarts mid-run. Ledger is built around the opposite assumption:
**crashes are normal, and the system is designed around surviving them,
not avoiding them.**

The end state:

- A user visually builds a workflow — a DAG of nodes (trigger → HTTP
  call → condition → email, etc.) — by dragging and connecting boxes on
  a canvas.
- They hit "run." The workflow executes step by step, and the canvas
  lights up live, node by node, as each one completes.
- At any point, you can kill the server process (or a worker) mid-run,
  restart it, and the workflow **resumes from exactly where it left
  off** — no duplicated side effects, no lost steps, no manual
  intervention.
- The demo moment: run a workflow, kill `-9` a worker process on stage
  mid-execution, restart it, and watch the run finish correctly. That's
  the thing a generic n8n clone cannot do, and the thing that makes an
  engineer watching immediately understand why this was hard.

This is the single sentence that should appear at the top of the
eventual README: *"A workflow automation engine where every execution
step is a permanent, replayable event — so the system can always prove
what actually happened, and always recover from where it stopped."*

---

## 2. Why this is genuinely hard (keep this list — it's the grading/demo pitch)

1. **Event-sourced execution** — there is no "current status" field that
   can silently drift from reality. Every step transition is an
   immutable, appended row in Postgres. Current state is *derived* by
   reading events, never trusted from memory.
2. **Safe concurrent job claiming** — multiple worker processes poll the
   same queue table. Two workers must never be able to grab the same
   job. Solved with `SELECT ... FOR UPDATE SKIP LOCKED`, not an
   in-memory mutex (which dies with the process).
3. **Crash-safe resumption** — a worker can die *mid-step*, not just
   between steps. On restart, the system must be able to tell, purely
   from Postgres state, whether a claimed-but-unfinished job actually
   completed, and either resume or safely retry it.
4. **Live state without polling** — the frontend reflects the database's
   truth in real time over WebSocket, not by refetching on a timer.

---

## 3. Architecture

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

### React app
- **Builder view**: canvas for placing nodes and drawing edges between
  them; each node has a type (trigger, HTTP request, condition, delay,
  email/notify) and a config form.
- **Live view**: subscribes to a WebSocket channel for a given run;
  highlights the currently executing node, marks completed nodes green
  and failed ones red, in real time.
- Saves/loads workflow definitions as JSON via the API.

### Express API
- CRUD endpoints for workflow definitions.
- `POST /runs` — enqueues a new run (inserts a `runs` row + the first
  `jobs` row); does **not** execute anything itself.
- WebSocket server that broadcasts `run_events` as they're inserted
  (via Postgres `LISTEN/NOTIFY` or a lightweight pub layer) to any
  client subscribed to that run.

### Postgres — the entire coordination layer
This is deliberately the center of the system, not an afterthought.
Everything workers and the API agree on lives here: `workflows`,
`runs`, `run_events` (the append-only log), and `jobs` (the queue).

### Worker pool
- One or more Node processes.
- Loop: claim a job (`FOR UPDATE SKIP LOCKED`) → execute the node's
  logic → append a `run_events` row → mark the job done → enqueue the
  next job(s) in the DAG if applicable → repeat.
- On startup, sweeps for jobs stuck `claimed` past a timeout with no
  matching completion event, and requeues them.

---

## 4. Database schema

```sql
-- workflow definitions (the DAG itself)
CREATE TABLE workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  definition JSONB NOT NULL,   -- { nodes: [...], edges: [...] }
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
  claimed_by TEXT,
  claimed_at TIMESTAMPTZ,
  available_at TIMESTAMPTZ DEFAULT now()  -- supports retry backoff
);
```

### The core trick: safe job claiming

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

`SKIP LOCKED` means a row another worker already has locked is invisible
to this query — so two workers can never claim the same job, with zero
application-level locking.

### Recovering after a crash

A periodic sweep (or on worker startup):

```sql
UPDATE jobs
SET status = 'queued', claimed_by = NULL
WHERE status = 'claimed'
  AND claimed_at < now() - interval '2 minutes'
  AND id NOT IN (
    SELECT (payload->>'job_id')::bigint FROM run_events
    WHERE event_type = 'step_completed'
  );
```

Any job claimed too long ago with no matching completion event gets put
back in the queue for another worker to pick up.

---

## 5. API surface (starting point)

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/workflows` | Create a workflow definition |
| `GET` | `/workflows/:id` | Fetch a workflow definition |
| `PUT` | `/workflows/:id` | Update a workflow definition |
| `POST` | `/runs` | Trigger a run of a workflow |
| `GET` | `/runs/:id` | Get a run's current status + event history |
| `WS` | `/runs/:id/stream` | Live event stream for a run |

---

## 6. Build order (semester-length, solo)

1. **Weeks 1–2 — schema + job claiming.** Stand up the four tables.
   Write a script spinning up 5 fake worker processes hammering the
   same queue concurrently; prove zero double-claims under load.
2. **Weeks 3–4 — single-node execution.** Hardcode one node type (HTTP
   call). Job → execute → event → job marked done, end-to-end, no UI.
3. **Weeks 5–6 — DAG execution.** Chain multiple nodes; handle
   conditional branches; only enqueue the next job once the previous
   node's `step_completed` event exists.
4. **Weeks 7–8 — crash recovery.** Deliberately `kill -9` a worker
   mid-execution; prove the run resumes correctly — no re-run of
   completed steps, no lost step.
5. **Weeks 9–10 — React builder.** Drag-and-drop canvas; save/load
   workflow JSON via the API.
6. **Weeks 11–12 — live view.** WebSocket event stream; nodes light up
   live as they execute.
7. **Weeks 13–14 — polish + demo.** Retry/backoff UI, the live
   "kill a worker on stage" demo, README with the architecture diagram
   and the pitch from section 1.

## 7. Stretch goals

- Conditional/branching nodes with parallel fan-out execution
- Per-node retry policy with exponential backoff
- Workflow versioning (edit without breaking in-flight runs)
- Scheduled/cron-triggered runs
- A public status page showing live + historical run stats

---

## 8. Notes for Claude Code

- Scaffold as a monorepo: `/api` (Express + workers), `/web` (React),
  shared `/db` migrations.
- Build section 4's schema and the claiming query *first*, with a
  standalone load-test script, before writing any node execution logic
  — that's the part that has to be provably correct.
- Keep worker execution logic pluggable per node `type`, so adding new
  node types later doesn't touch the queue/event-sourcing core.