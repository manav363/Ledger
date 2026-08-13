import { pool } from "../db/pool.js";
import type { Job } from "./claimJob.js";
import { completeJob } from "./completeJob.js";
import { failJob } from "./failJob.js";
import { loadNode } from "./loadNode.js";
import { executeNode } from "../nodes/registry.js";

export type JobOutcome = "done" | "retry" | "failed";

// The full lifecycle of one claimed job: emit step_started, resolve the node,
// execute it, then either complete (with output) or fail (retry/give-up).
// Shared by the worker loop and the execution tests so both take the exact path.
export async function runJob(job: Job, workerId: string): Promise<JobOutcome> {
  await pool.query(
    `INSERT INTO run_events (run_id, node_id, event_type, payload)
     VALUES ($1, $2, 'step_started', $3)`,
    [job.run_id, job.node_id, JSON.stringify({ job_id: job.id, worker: workerId, attempt: job.attempts })],
  );

  try {
    const node = await loadNode(job.run_id, job.node_id);
    const output = await executeNode(node, { runId: job.run_id, attempt: job.attempts });
    await completeJob(job, output);
    return "done";
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const retried = await failJob(job, error);
    return retried ? "retry" : "failed";
  }
}
