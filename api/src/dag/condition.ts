import { fileURLToPath } from "node:url";
import type { EdgeCondition } from "./types.js";

function getPath(obj: unknown, path: string): unknown {
  if (path === "") return obj;
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

// Decides whether an edge is traversed, given the source node's output.
export function evaluateCondition(sourceOutput: unknown, cond: EdgeCondition): boolean {
  const actual = getPath(sourceOutput, cond.path);
  switch (cond.op) {
    case "truthy":
      return Boolean(actual);
    case "falsy":
      return !actual;
    case "eq":
      return actual === cond.value;
    case "ne":
      return actual !== cond.value;
    case "lt":
    case "lte":
    case "gt":
    case "gte": {
      if (typeof actual !== "number" || typeof cond.value !== "number") return false;
      if (cond.op === "lt") return actual < cond.value;
      if (cond.op === "lte") return actual <= cond.value;
      if (cond.op === "gt") return actual > cond.value;
      return actual >= cond.value;
    }
  }
}

function demo(): void {
  const assert = (c: boolean, m: string): void => {
    if (!c) throw new Error(`condition demo failed: ${m}`);
  };
  assert(evaluateCondition({ status: 200 }, { path: "status", op: "lt", value: 400 }), "200<400");
  assert(!evaluateCondition({ status: 500 }, { path: "status", op: "lt", value: 400 }), "500 not <400");
  assert(evaluateCondition({ status: 500 }, { path: "status", op: "gte", value: 400 }), "500>=400");
  assert(evaluateCondition({ ok: true }, { path: "ok", op: "truthy" }), "ok truthy");
  assert(evaluateCondition("x", { path: "", op: "eq", value: "x" }), "whole-value eq");
  assert(!evaluateCondition({ a: { b: 1 } }, { path: "a.b", op: "eq", value: 2 }), "nested ne");
  console.log("condition demo ok");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) demo();
