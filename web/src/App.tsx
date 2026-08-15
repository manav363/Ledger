import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type NodeTypes,
} from "@xyflow/react";
import { api, type EdgeCondition, type WorkflowSummary } from "./lib/api";
import { openRunStream, type LogEntry } from "./lib/runStream";
import { RunLog } from "./components/RunLog";
import { LedgerNode as LedgerNodeView } from "./components/LedgerNode";
import { Palette } from "./components/Palette";
import { ConfigPanel } from "./components/ConfigPanel";
import { toDefinition, fromDefinition, nextNodeId, type LedgerNode, type LedgerEdge } from "./lib/graph";

const nodeTypes: NodeTypes = { ledger: LedgerNodeView };
const RUN_PILL: Record<string, string> = { running: "running", completed: "completed", failed: "failed" };

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<LedgerNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<LedgerEdge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [name, setName] = useState("Untitled workflow");
  const [list, setList] = useState<WorkflowSummary[]>([]);
  const [run, setRun] = useState<{ id: string; status: string } | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const refreshList = useCallback(() => {
    api.listWorkflows().then(setList).catch((e) => setError(e.message));
  }, []);
  useEffect(refreshList, [refreshList]);

  // Reflect real API reachability in the connection indicator.
  useEffect(() => {
    let alive = true;
    const ping = () =>
      fetch("/api/health")
        .then((r) => alive && setConnected(r.ok))
        .catch(() => alive && setConnected(false));
    ping();
    const t = setInterval(ping, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedNodeId) ?? null, [nodes, selectedNodeId]);
  const selectedEdge = useMemo(() => edges.find((e) => e.id === selectedEdgeId) ?? null, [edges, selectedEdgeId]);

  // Live run stream over WebSocket (Postgres LISTEN/NOTIFY) — opens when a run
  // starts, closes when the run changes or the component unmounts.
  useEffect(() => {
    if (!run) return;
    return openRunStream(run.id, {
      onSnapshot: (states, status, events) => {
        setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, status: states[n.id] } })));
        setRun((r) => (r ? { ...r, status } : r));
        setLog(events);
      },
      onEvent: (nodeId, eventType) => {
        setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, status: eventType } } : n)));
        setLog((l) => [...l, { node_id: nodeId, event_type: eventType, created_at: new Date().toISOString() }]);
      },
      onStatus: (status) => setRun((r) => (r ? { ...r, status } : r)),
    });
  }, [run?.id, setNodes]);

  const addNode = (type: string) => {
    setNodes((ns) => {
      const id = nextNodeId(ns, type);
      const node: LedgerNode = {
        id,
        type: "ledger",
        position: { x: 200 + ns.length * 40, y: 120 + ns.length * 60 },
        data: { nodeType: type, config: {} },
      };
      return [...ns, node];
    });
  };

  const onConnect = useCallback((c: Connection) => setEdges((eds) => addEdge({ ...c, data: {} }, eds)), [setEdges]);

  const clearStatuses = () => setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, status: undefined } })));

  const updateNodeConfig = (config: Record<string, unknown>) =>
    setNodes((ns) => ns.map((n) => (n.id === selectedNodeId ? { ...n, data: { ...n.data, config } } : n)));

  const updateEdgeCondition = (when: EdgeCondition | undefined) =>
    setEdges((es) => es.map((e) => (e.id === selectedEdgeId ? { ...e, data: { when }, label: when ? `${when.path} ${when.op} ${when.value ?? ""}`.trim() : undefined } : e)));

  const deleteSelected = () => {
    if (selectedNodeId) {
      setNodes((ns) => ns.filter((n) => n.id !== selectedNodeId));
      setEdges((es) => es.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId));
      setSelectedNodeId(null);
    } else if (selectedEdgeId) {
      setEdges((es) => es.filter((e) => e.id !== selectedEdgeId));
      setSelectedEdgeId(null);
    }
  };

  const save = async (): Promise<string | null> => {
    setError(null);
    const def = toDefinition(nodes, edges);
    try {
      const wf = workflowId ? await api.updateWorkflow(workflowId, name, def) : await api.createWorkflow(name, def);
      setWorkflowId(wf.id);
      setName(wf.name);
      refreshList();
      return wf.id;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  };

  const open = async (id: string) => {
    setError(null);
    try {
      const wf = await api.getWorkflow(id);
      const g = fromDefinition(wf.definition);
      setNodes(g.nodes);
      setEdges(g.edges);
      setWorkflowId(wf.id);
      setName(wf.name);
      setRun(null);
      setLog([]);
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const newWorkflow = () => {
    setNodes([]);
    setEdges([]);
    setWorkflowId(null);
    setName("Untitled workflow");
    setRun(null);
    setLog([]);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  };

  const runWorkflow = async () => {
    if (nodes.length === 0) return setError("Add at least one node before running.");
    const id = await save(); // persist current canvas first
    if (!id) return;
    clearStatuses();
    setLog([]);
    try {
      const { run_id } = await api.startRun(id);
      setRun({ id: run_id, status: "running" });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const isRunning = run?.status === "running";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand__name">LEDGER</span>
          <span className="brand__tag">workflow engine</span>
        </div>
        <div className="conn">
          <span className={`conn__dot ${connected ? "" : "conn__dot--off"}`} />
          <span className="conn__label">{connected ? "api · web — connected" : "api — offline"}</span>
        </div>
      </header>

      <div className="subbar">
        <input className="subbar__name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Workflow name" />
        <span className="subbar__count">{nodes.length} nodes · {edges.length} edges</span>
        <div className="subbar__actions">
          <select className="btn" value="" onChange={(e) => e.target.value && open(e.target.value)} aria-label="Open workflow">
            <option value="">Open…</option>
            {list.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
          <button className="btn" onClick={newWorkflow}>New</button>
          <button className="btn" onClick={save}>Save</button>
          <button className="btn btn--run" onClick={runWorkflow}>
            <span className="btn__dot" />
            Run
          </button>
          {run && (
            <span className={`pill pill--${RUN_PILL[run.status] ?? "running"}`}>
              <span className="pill__dot" />
              {run.status}
            </span>
          )}
        </div>
      </div>

      {error && <div className="error-bar" onClick={() => setError(null)}>⚠ {error} <span className="error-bar__dismiss">dismiss</span></div>}

      <div className="workspace">
        <aside className="rail">
          <Palette onAdd={addNode} />
        </aside>

        <main className={`canvas ${isRunning ? "canvas--running" : ""}`}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            onSelectionChange={({ nodes: sn, edges: se }) => {
              setSelectedNodeId(sn[0]?.id ?? null);
              setSelectedEdgeId(se[0]?.id ?? null);
            }}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Controls showInteractive={false} />
          </ReactFlow>

          <aside className="panel">
            <div className="panel__scroll">
              <ConfigPanel
                key={selectedNodeId ?? selectedEdgeId ?? "none"}
                node={selectedNode}
                edge={selectedNode ? null : selectedEdge}
                onNodeConfig={updateNodeConfig}
                onEdgeCondition={updateEdgeCondition}
                onDelete={deleteSelected}
              />
            </div>
            <RunLog events={log} />
          </aside>
        </main>
      </div>
    </div>
  );
}
