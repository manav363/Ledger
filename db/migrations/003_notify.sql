-- Live view: the DB itself announces every change, so the API doesn't have to
-- poll. Payloads are tiny (ids + a short string) — far under NOTIFY's 8000-byte
-- cap — and fire on COMMIT, so a listener only sees durable state.

-- Every appended event -> notify.
CREATE OR REPLACE FUNCTION notify_run_event() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('ledger', json_build_object(
    'kind', 'event',
    'run_id', NEW.run_id,
    'node_id', NEW.node_id,
    'event_type', NEW.event_type
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notify_run_event
  AFTER INSERT ON run_events
  FOR EACH ROW EXECUTE FUNCTION notify_run_event();

-- Every run status transition -> notify (drives the run badge live).
CREATE OR REPLACE FUNCTION notify_run_status() RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM pg_notify('ledger', json_build_object(
      'kind', 'status',
      'run_id', NEW.id,
      'status', NEW.status
    )::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notify_run_status
  AFTER UPDATE ON runs
  FOR EACH ROW EXECUTE FUNCTION notify_run_status();
