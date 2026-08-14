// Frontend metadata for each node type: how it appears in the palette and which
// config fields its form shows. Mirrors the backend registry (api/src/nodes).
export type FieldKind = "text" | "number" | "json" | "select";

export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  options?: string[];
  placeholder?: string;
}

export interface NodeSpec {
  type: string;
  label: string;
  accent: string; // CSS custom-property name for this type's color
  fields: FieldSpec[];
}

export const NODE_SPECS: NodeSpec[] = [
  {
    type: "http",
    label: "HTTP Request",
    accent: "--node-http",
    fields: [
      { key: "method", label: "Method", kind: "select", options: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
      { key: "url", label: "URL", kind: "text", placeholder: "https://api.example.com/…" },
      { key: "headers", label: "Headers (JSON)", kind: "json", placeholder: '{ "authorization": "…" }' },
      { key: "body", label: "Body (JSON)", kind: "json", placeholder: '{ "key": "value" }' },
    ],
  },
  {
    type: "noop",
    label: "No-op",
    accent: "--node-noop",
    fields: [{ key: "emit", label: "Emit value", kind: "text", placeholder: "passed through as output.value" }],
  },
  {
    type: "sleep",
    label: "Delay",
    accent: "--node-sleep",
    fields: [{ key: "ms", label: "Duration (ms)", kind: "number", placeholder: "1000" }],
  },
];

export const specFor = (type: string): NodeSpec | undefined => NODE_SPECS.find((s) => s.type === type);

export const CONDITION_OPS = ["eq", "ne", "lt", "lte", "gt", "gte", "truthy", "falsy"] as const;
