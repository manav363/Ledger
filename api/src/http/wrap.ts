import type { RequestHandler } from "express";

// Express 4 doesn't forward async-handler rejections to the error middleware —
// an unhandled rejection crashes the process. Wrap every async route so a thrown
// query becomes a 500 instead.
export const wrap =
  (handler: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);
