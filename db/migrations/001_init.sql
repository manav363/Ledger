CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- workflow definitions (the DAG itself)
CREATE TABLE workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  definition JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- one row per execution of a workflow
CREATE TABLE runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES workflows(id),
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

-- append-only event log — the source of truth
CREATE TABLE run_events (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID REFERENCES runs(id),
  node_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- the job queue — what workers poll
CREATE TABLE jobs (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID REFERENCES runs(id),
  node_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INT NOT NULL DEFAULT 0,
  claimed_by TEXT,
  claimed_at TIMESTAMPTZ,
  available_at TIMESTAMPTZ DEFAULT now()
);

-- supports the claim query's WHERE status = 'queued' AND available_at <= now() ORDER BY id
CREATE INDEX idx_jobs_claimable ON jobs (status, available_at, id);
