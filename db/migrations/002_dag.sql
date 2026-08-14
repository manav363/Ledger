-- One job per (run, node): a DAG is acyclic, a node runs at most once per run,
-- and retries reuse the same row. This makes advanceDag's enqueue idempotent —
-- concurrent fan-in completions both INSERT ... ON CONFLICT DO NOTHING and only
-- one row survives, so a join node is never enqueued twice.
CREATE UNIQUE INDEX idx_jobs_run_node ON jobs (run_id, node_id);
