# How a run works — a guided tour

The five-minute version of Ledger's execution path, with the file behind each step. The full reference is [`system_architecture.md`](system_architecture.md); the reasoning behind the choices is in [`design-decisions.md`](design-decisions.md).

The one idea to hold onto: **Postgres is the only place state lives.** The API and the workers are stateless processes. Any of them can die, and another one continues from what the database says.

## The pieces

| Piece | Where | Job |
|---|---|---|
| REST API + WebSocket | `api/src/http/` | Save workflows, start runs, stream a run's progress to the browser |
| Worker | `api/src/queue/worker-entry.ts` | Loop: claim a job, run it, repeat. Sweeps for abandoned jobs on startup and every 30s |
| DAG engine | `api/src/dag/` | Decides which nodes become runnable once a node finishes |
| Node handlers | `api/src/nodes/` | What a node actually does (`http`, `noop`, `sleep`), looked up through one registry |
| Schema | `db/migrations/` | `workflows`, `runs`, `run_events`, `jobs`, plus the NOTIFY triggers |

## One run, step by step

### 1. A run starts

`POST /api/runs` calls `startRun` (`api/src/queue/startRun.ts`). In a single transaction it inserts a `runs` row with `status = 'running'` and one `jobs` row for every **root node** (a node with no incoming edge). Nothing else is queued yet. If a workflow has nodes but no root, it is a cycle and the run is rejected.

### 2. A worker claims a job

`worker-entry.ts` polls `claimJob` every 20 ms. `claimJob` is one `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1)`. A row that another worker is in the middle of claiming is invisible to the subquery, so two workers can never take the same job. The claim also increments `attempts`.

### 3. The node executes

`runJob` (`api/src/queue/runJob.ts`) does four things in order:

1. Insert a `step_started` event (worker id, attempt number).
2. Load the node definition from the run's workflow.
3. Build the node's input from its parents: `gatherInputs` reads each parent's `step_completed` output from the event log.
4. Call `executeNode`, which looks the handler up in `registry.ts`.

### 4. Completion is atomic

On success `completeJob` opens one transaction that:

1. takes a per-run advisory lock (`pg_advisory_xact_lock`) so two completions in the same run are serialized,
2. marks the job `done`,
3. inserts the `step_completed` event with the node's output,
4. calls `advanceDag`, which enqueues any successor that is now ready,
5. recomputes `runs.status` with `refreshRunStatus`,
6. commits.

If the process dies anywhere inside that transaction, none of it happened. A step is never "completed but its successors were not queued".

### 5. The DAG advances

`advanceDag` (`api/src/dag/advance.ts`) looks at every successor of the node that just finished. A successor is ready when every parent has a `step_completed` event and every conditional edge into it evaluates true against its parent's output. Ready successors are inserted with `ON CONFLICT DO NOTHING`; the unique index on `jobs (run_id, node_id)` means a fan-in join node can only ever be enqueued once, even if its parents finish at the same moment.

### 6. Failure and retry

If the handler throws, `failJob` writes either a `retry` or a `step_failed` event. A job gets 3 attempts. Between attempts it goes back to `queued` with `available_at` pushed out by an exponential backoff (1 s, then 2 s; `WORKER_BACKOFF_MS` changes the base). After the third failure the job is `failed` and the run becomes `failed`. Note that an HTTP 4xx or 5xx is a *result* of the `http` node, not an error; only transport failures retry.

### 7. A worker is killed mid-step

The job stays `claimed` and nothing is written. The next sweep (`recoverStuckJobs`) requeues every job that has been `claimed` for longer than `WORKER_STUCK_TIMEOUT_MS` (default 2 minutes) **and** has no `step_completed` event in the log. Another worker claims it and runs it from the start.

`npm run demo:crash` shows this: the killed step has two `step_started` events and one `step_completed`; steps that had already finished are untouched.

### 8. The browser sees it live

Migration `003_notify.sql` adds triggers that call `pg_notify('ledger', ...)` on every `run_events` insert and every `runs.status` change. Notifications fire on commit, so a listener only sees durable state. The API holds one dedicated `LISTEN` connection (`api/src/http/liveEvents.ts`, not a pooled one, because a pool can recycle the connection and silently drop the subscription) and forwards each notification to the WebSockets watching that run.

## What is and is not guaranteed

| Guarantee | Holds? | Why |
|---|---|---|
| Two workers never claim the same job | Yes | `FOR UPDATE SKIP LOCKED`; tested with 5 OS processes draining 500 jobs |
| A finished step never runs again | Yes | Completion is one transaction; recovery skips any job that has a `step_completed` event |
| A join node is queued once | Yes | Advisory lock plus unique index and `ON CONFLICT DO NOTHING` |
| An interrupted step runs again | **At-least-once** | The step may have had side effects before the worker died. An `http` POST can be sent twice |
| A slow worker is not mistaken for a dead one | **No** | Recovery is timeout-based, not heartbeat-based; a job slower than the timeout can be requeued while still running |
| A join after a skipped conditional branch fires | **No** | No dead-path elimination yet |
| Endpoints are protected | **No** | There is no authentication |

## Try it

```bash
npm run demo:crash
```

Then look at the log the demo wrote:

```sql
SELECT node_id, event_type, payload->>'worker' AS worker
FROM run_events ORDER BY id;
```
