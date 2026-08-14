import type { PoolClient } from "pg";

// Derives runs.status from the job projection of the event log and writes it in
// the caller's transaction. Because advanceDag enqueues successors synchronously
// at completion, "no active jobs left and at least one done" means the DAG has
// quiesced -> completed. Any failed job marks the whole run failed.
export async function refreshRunStatus(client: PoolClient, runId: string): Promise<void> {
  const { rows: [c] } = await client.query<{ failed: string; active: string; done: string }>(
    `SELECT
       count(*) FILTER (WHERE status = 'failed')              AS failed,
       count(*) FILTER (WHERE status IN ('queued', 'claimed')) AS active,
       count(*) FILTER (WHERE status = 'done')                AS done
     FROM jobs WHERE run_id = $1`,
    [runId],
  );

  let status: string;
  let finished: boolean;
  if (Number(c.failed) > 0) {
    status = "failed";
    finished = true;
  } else if (Number(c.active) === 0 && Number(c.done) > 0) {
    status = "completed";
    finished = true;
  } else {
    status = "running";
    finished = false;
  }

  await client.query(
    `UPDATE runs
     SET status = $2,
         started_at = COALESCE(started_at, now()),
         finished_at = ${finished ? "now()" : "NULL"}
     WHERE id = $1`,
    [runId, status],
  );
}
