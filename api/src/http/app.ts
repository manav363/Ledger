import express from "express";
import { workflows } from "./workflows.js";
import { runs } from "./runs.js";
import { nodeTypes } from "../nodes/registry.js";

// Builds the Express app (no listen) so it can be mounted or tested directly.
export function createApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("/api/node-types", (_req, res) => res.json(nodeTypes));
  app.use("/api/workflows", workflows);
  app.use("/api/runs", runs);

  // Last-resort error handler so a thrown query never hangs the request.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "internal error" });
  });

  return app;
}
