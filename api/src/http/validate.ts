import { nodeTypes } from "../nodes/registry.js";
import type { WorkflowDefinition } from "../dag/types.js";

// Validates a workflow definition at the API boundary — never trust the request
// body. Returns a list of human-readable errors (empty = valid).
export function validateDefinition(input: unknown): { errors: string[]; definition?: WorkflowDefinition } {
  const errors: string[] = [];
  if (typeof input !== "object" || input === null) {
    return { errors: ["definition must be an object with `nodes` and `edges`"] };
  }
  const def = input as Record<string, unknown>;
  const nodes = def.nodes;
  const edges = def.edges ?? [];

  if (!Array.isArray(nodes)) return { errors: ["`nodes` must be an array"] };
  if (!Array.isArray(edges)) return { errors: ["`edges` must be an array"] };

  const ids = new Set<string>();
  for (const [i, n] of nodes.entries()) {
    if (typeof n !== "object" || n === null) {
      errors.push(`nodes[${i}] must be an object`);
      continue;
    }
    const node = n as Record<string, unknown>;
    if (typeof node.id !== "string" || node.id === "") errors.push(`nodes[${i}].id must be a non-empty string`);
    else if (ids.has(node.id)) errors.push(`duplicate node id '${node.id}'`);
    else ids.add(node.id);
    if (typeof node.type !== "string" || !nodeTypes.includes(node.type)) {
      errors.push(`nodes[${i}].type must be one of: ${nodeTypes.join(", ")}`);
    }
    if (node.config !== undefined && (typeof node.config !== "object" || node.config === null)) {
      errors.push(`nodes[${i}].config must be an object`);
    }
  }

  for (const [i, e] of edges.entries()) {
    if (typeof e !== "object" || e === null) {
      errors.push(`edges[${i}] must be an object`);
      continue;
    }
    const edge = e as Record<string, unknown>;
    if (typeof edge.from !== "string" || !ids.has(edge.from)) errors.push(`edges[${i}].from must reference an existing node id`);
    if (typeof edge.to !== "string" || !ids.has(edge.to)) errors.push(`edges[${i}].to must reference an existing node id`);
  }

  if (errors.length > 0) return { errors };
  return { errors: [], definition: input as WorkflowDefinition };
}
