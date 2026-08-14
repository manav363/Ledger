import { useEffect, useState } from "react";
import type { EdgeCondition } from "../lib/api";
import { specFor, CONDITION_OPS } from "../lib/nodeSpecs";
import type { LedgerNode, LedgerEdge } from "../lib/graph";

interface ConfigPanelProps {
  node: LedgerNode | null;
  edge: LedgerEdge | null;
  onNodeConfig: (config: Record<string, unknown>) => void;
  onEdgeCondition: (when: EdgeCondition | undefined) => void;
  onDelete: () => void;
}

// Best-effort coercion of a free-text condition value: number, boolean, else string.
function coerce(raw: string): unknown {
  if (raw.trim() === "") return "";
  if (raw === "true") return true;
  if (raw === "false") return false;
  const n = Number(raw);
  return Number.isNaN(n) ? raw : n;
}

export function ConfigPanel(props: ConfigPanelProps) {
  if (props.node) return <NodeConfig node={props.node} onChange={props.onNodeConfig} onDelete={props.onDelete} />;
  if (props.edge) return <EdgeConfig edge={props.edge} onChange={props.onEdgeCondition} onDelete={props.onDelete} />;
  return (
    <div className="config config--empty">
      <p>Select a node to configure it, or an edge to add a branch condition.</p>
    </div>
  );
}

function NodeConfig({ node, onChange, onDelete }: { node: LedgerNode; onChange: (c: Record<string, unknown>) => void; onDelete: () => void }) {
  const spec = specFor(node.data.nodeType);
  const config = node.data.config;
  const [jsonText, setJsonText] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of spec?.fields ?? []) {
      if (f.kind === "json") init[f.key] = config[f.key] !== undefined ? JSON.stringify(config[f.key], null, 2) : "";
    }
    return init;
  });
  const [jsonErr, setJsonErr] = useState<Record<string, boolean>>({});

  const setField = (key: string, value: unknown) => onChange({ ...config, [key]: value });
  const clearField = (key: string) => {
    const next = { ...config };
    delete next[key];
    onChange(next);
  };

  return (
    <div className="config">
      <h2 className="panel__title">{spec?.label ?? node.data.nodeType}</h2>
      <div className="config__meta">
        <span className="config__id">{node.id}</span>
      </div>
      {spec?.fields.map((f) => (
        <label key={f.key} className="field">
          <span className="field__label">{f.label}</span>
          {f.kind === "select" && (
            <select value={String(config[f.key] ?? f.options?.[0] ?? "")} onChange={(e) => setField(f.key, e.target.value)}>
              {f.options?.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          )}
          {f.kind === "text" && (
            <input
              value={String(config[f.key] ?? "")}
              placeholder={f.placeholder}
              onChange={(e) => (e.target.value === "" ? clearField(f.key) : setField(f.key, e.target.value))}
            />
          )}
          {f.kind === "number" && (
            <input
              type="number"
              value={config[f.key] === undefined ? "" : String(config[f.key])}
              placeholder={f.placeholder}
              onChange={(e) => (e.target.value === "" ? clearField(f.key) : setField(f.key, Number(e.target.value)))}
            />
          )}
          {f.kind === "json" && (
            <>
              <textarea
                className={jsonErr[f.key] ? "field--error" : ""}
                rows={4}
                value={jsonText[f.key] ?? ""}
                placeholder={f.placeholder}
                onChange={(e) => {
                  const text = e.target.value;
                  setJsonText((s) => ({ ...s, [f.key]: text }));
                  if (text.trim() === "") {
                    setJsonErr((s) => ({ ...s, [f.key]: false }));
                    clearField(f.key);
                    return;
                  }
                  try {
                    setField(f.key, JSON.parse(text));
                    setJsonErr((s) => ({ ...s, [f.key]: false }));
                  } catch {
                    setJsonErr((s) => ({ ...s, [f.key]: true }));
                  }
                }}
              />
              {jsonErr[f.key] && <span className="field__err">invalid JSON — not saved</span>}
            </>
          )}
        </label>
      ))}
      <button className="btn btn--danger" onClick={onDelete}>Delete node</button>
    </div>
  );
}

function EdgeConfig({ edge, onChange, onDelete }: { edge: LedgerEdge; onChange: (w: EdgeCondition | undefined) => void; onDelete: () => void }) {
  const when = edge.data?.when;
  const [enabled, setEnabled] = useState(Boolean(when));
  const [path, setPath] = useState(when?.path ?? "");
  const [op, setOp] = useState<string>(when?.op ?? "eq");
  const [value, setValue] = useState(when?.value !== undefined ? String(when.value) : "");
  const needsValue = op !== "truthy" && op !== "falsy";

  useEffect(() => {
    if (!enabled) return onChange(undefined);
    const cond: EdgeCondition = { path, op };
    if (needsValue) cond.value = coerce(value);
    onChange(cond);
  }, [enabled, path, op, value, needsValue]);

  return (
    <div className="config">
      <h2 className="panel__title">Edge</h2>
      <div className="config__meta">
        <span className="config__id">{edge.source} → {edge.target}</span>
      </div>
      <label className="field field--row">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span className="field__label">Conditional branch</span>
      </label>
      {enabled && (
        <>
          <label className="field">
            <span className="field__label">Source output path</span>
            <input value={path} placeholder="e.g. status  or  body.ok" onChange={(e) => setPath(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">Operator</span>
            <select value={op} onChange={(e) => setOp(e.target.value)}>
              {CONDITION_OPS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </label>
          {needsValue && (
            <label className="field">
              <span className="field__label">Value</span>
              <input value={value} placeholder="e.g. 400" onChange={(e) => setValue(e.target.value)} />
            </label>
          )}
          <p className="config__hint">Take this edge only when the source node's output satisfies the condition.</p>
        </>
      )}
      <button className="btn btn--danger" onClick={onDelete}>Delete edge</button>
    </div>
  );
}
