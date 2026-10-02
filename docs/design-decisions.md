# Design decisions

Seven choices that shape Ledger, each with what it buys and what it costs. For the mechanics behind them see [`how-it-works.md`](how-it-works.md).

## 1. Postgres is the queue

**Decision:** Jobs live in a `jobs` table; no Redis, RabbitMQ or queue library.
**Why:** A second system means a second place state can disagree. With one database, "enqueue the next step" can happen in the *same transaction* as "record that this step finished", which is what makes crash recovery tractable.
**Cost:** Polling a table is less efficient than a purpose-built broker and tops out at far lower throughput. Workers poll every 20 ms.

## 2. The event log decides what happened

**Decision:** `run_events` is append-only. Step outputs live there, and recovery asks the log (not a status flag) whether a step finished.
**Why:** A mutable status can drift from reality after a crash. An event that was inserted in a committed transaction is a fact.
**Cost:** Reading a node's input means querying events (`DISTINCT ON (node_id) ... ORDER BY id DESC`) rather than reading a column. Two mutable fields remain by design: `jobs.status` is queue bookkeeping, and `runs.status` is a cached value that `refreshRunStatus` recomputes on every completion or failure.

## 3. Claim jobs with `FOR UPDATE SKIP LOCKED`

**Decision:** One `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1)`.
**Why:** Rows locked by another worker are skipped instead of waited on, so workers never block each other and never double-claim.
**Cost:** Strict ordering by `id` is best-effort once rows are retried with a later `available_at`.

## 4. Completion, DAG advance and run status are one transaction

**Decision:** `completeJob` marks the job done, inserts `step_completed`, enqueues successors and updates `runs.status` between one `BEGIN` and `COMMIT`, under `pg_advisory_xact_lock` keyed on the run.
**Why:** A crash can commit all of it or none of it. The advisory lock makes two parents of a join see each other's committed events instead of both concluding "my sibling hasn't finished".
**Cost:** Completions within one run are serialized.

## 5. Idempotent enqueue

**Decision:** `UNIQUE (run_id, node_id)` on `jobs`, and every enqueue uses `ON CONFLICT DO NOTHING`.
**Why:** A node runs at most once per run in an acyclic graph, so the database can enforce "queued once" even if application code races.
**Cost:** Retries must reuse the same row (they do, via `attempts` and `available_at`). A node cannot be re-run inside the same run without a schema change.

## 6. Live updates through `LISTEN/NOTIFY`

**Decision:** Triggers publish a small JSON payload on every event insert and status change; one dedicated connection in the API relays them to WebSockets.
**Why:** No polling from the browser or the API, and notifications fire on commit.
**Cost:** `LISTEN` is session-scoped, so it cannot use the pool; the connection needs reconnect logic. Payloads must stay under NOTIFY's size limit, so they carry ids, not data.

## 7. Timeout-based crash recovery

**Decision:** A sweep requeues jobs that have been `claimed` longer than `WORKER_STUCK_TIMEOUT_MS` (default 2 minutes) and have no `step_completed` event.
**Why:** It is simple and needs no extra moving parts.
**Cost:** The timeout cannot tell a dead worker from a slow one. Too short and a live worker's job runs twice; too long and recovery is slow. This is the weakest part of the design.

## Next steps worth taking

- **Idempotency keys on the `http` node**, so a replayed POST can be de-duplicated by the receiver.
- **Dead-path elimination**, propagating a "skipped" result so a join after a conditional branch can fire.
- **Heartbeats** in place of a fixed timeout, so recovery tracks liveness rather than elapsed time.
- **Authentication** on the API.
