import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
import { api, type EdgeCondition, type WorkflowSummary } from "./lib/api";
import { openRunStream, type LogEntry } from "./lib/runStream";
import { timeAgo } from "./lib/time";
import { RunLog } from "./components/RunLog";
import { WorkflowList } from "./components/WorkflowList";
import { LedgerNode as LedgerNodeView } from "./components/LedgerNode";
import { Palette } from "./components/Palette";
import { ConfigPanel } from "./components/ConfigPanel";
import { toDefinition, fromDefinition, nextNodeId, type LedgerNode, type LedgerEdge } from "./lib/graph";

const nodeTypes: NodeTypes = { ledger: LedgerNodeView };
const RUN_PILL: Record<string, string> = { running: "running", completed: "completed", failed: "failed" };

type Screen = "list" | "canvas" | "run";
interface Run { id: string; status: string; startedAt?: string }

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<LedgerNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<LedgerEdge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [name, setName] = useState("Untitled workflow");
  const [list, setList] = useState<WorkflowSummary[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [screen, setScreen] = useState<Screen>("list");
  const rf = useRef<ReactFlowInstance<LedgerNode, LedgerEdge> | null>(null);

  const refreshList = useCallback(() => {
    api.listWorkflows().then(setList).catch((e) => setError(e.message));
  }, []);
  useEffect(refreshList, [refreshList]);

  useEffect(() => {
    let alive = true;
    const ping = () => fetch("/api/health").then((r) => alive && setConnected(r.ok)).catch(() => alive && setConnected(false));
    ping();
    const t = setInterval(ping, 15000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedNodeId) ?? null, [nodes, selectedNodeId]);
  const selectedEdge = useMemo(() => edges.find((e) => e.id === selectedEdgeId) ?? null, [edges, selectedEdgeId]);

  // Recenter after the graph changes (nodes measure a tick after they mount).
  const fitSoon = () => setTimeout(() => rf.current?.fitView({ duration: 200, padding: 0.2 }), 80);

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
      return [...ns, { id, type: "ledger", position: { x: 200 + ns.length * 40, y: 120 + ns.length * 60 }, data: { nodeType: type, config: {} } }];
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
      setScreen("canvas");
      fitSoon();
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
    setScreen("canvas");
  };

  const runWorkflow = async () => {
    if (nodes.length === 0) return setError("Add at least one node before running.");
    const id = await save();
    if (!id) return;
    clearStatuses();
    setLog([]);
    try {
      const { run_id } = await api.startRun(id);
      setRun({ id: run_id, status: "running", startedAt: new Date().toISOString() });
      setScreen("run");
      fitSoon();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const goList = () => { refreshList(); setScreen("list"); };
  const goCanvas = () => { setScreen("canvas"); fitSoon(); };

  const isRunning = run?.status === "running";
  const isCanvas = screen === "canvas";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand__name">LEDGER</span>
          <span className="brand__tag">workflow engine</span>
        </div>
        <nav className="nav">
          <NavItem num="01" label="WORKFLOWS" active={screen === "list"} onClick={goList} />
          <NavItem num="02" label="CANVAS" active={screen === "canvas"} disabled={nodes.length === 0 && !workflowId} onClick={goCanvas} />
          <NavItem num="03" label="RUN" active={screen === "run"} disabled={!run} onClick={() => run && setScreen("run")} />
        </nav>
        <div className="conn">
          <span className={`conn__dot ${connected ? "" : "conn__dot--off"}`} />
          <span className="conn__label">{connected ? "api · web — connected" : "api — offline"}</span>
        </div>
      </header>

      {error && <div className="error-bar" onClick={() => setError(null)}>⚠ {error} <span className="error-bar__dismiss">dismiss</span></div>}

      {/* ReactFlow is always mounted (warm) in an explicitly-sized container, so
          it initialises before any workflow is loaded — a fresh @xyflow mount can
          leave nodes unmeasured (edges then never render). The list is an overlay. */}
      <div className="body">
        <div className="subbar">
          {screen === "canvas" && (
            <>
              <a className="subbar__back" onClick={goList}>← Workflows</a>
              <span className="subbar__div" />
              <input className="subbar__name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Workflow name" />
              <span className="subbar__count">{nodes.length} nodes · {edges.length} edges</span>
              <div className="subbar__actions">
                <button className="btn" onClick={save}>Save</button>
                <button className="btn btn--run" onClick={runWorkflow}><span className="btn__dot" />Run</button>
              </div>
            </>
          )}
          {screen === "run" && (
            <>
              <a className="subbar__back" onClick={goCanvas}>← Canvas</a>
              <span className="subbar__div" />
              <span className="subbar__wfname">{name}</span>
              {run && <span className="subbar__count">{run.id.slice(0, 8)}</span>}
              {run && <span className={`pill pill--${RUN_PILL[run.status] ?? "running"}`}><span className="pill__dot" />{run.status}</span>}
              {run && <StartedAgo startedAt={run.startedAt} running={isRunning} />}
            </>
          )}
        </div>

        <div className="workspace">
          {isCanvas && (
            <aside className="rail">
              <Palette onAdd={addNode} />
            </aside>
          )}
          <main className={`canvas ${isRunning ? "canvas--running" : ""}`}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              nodeTypes={nodeTypes}
              nodesDraggable={isCanvas}
              nodesConnectable={isCanvas}
              elementsSelectable={isCanvas}
              onSelectionChange={({ nodes: sn, edges: se }) => {
                setSelectedNodeId(sn[0]?.id ?? null);
                setSelectedEdgeId(se[0]?.id ?? null);
              }}
              onInit={(inst) => (rf.current = inst)}
              fitView
              proOptions={{ hideAttribution: true }}
            >
              <Controls showInteractive={false} />
            </ReactFlow>

            <aside className="panel">
              {screen === "run" ? (
                <RunLog events={log} />
              ) : (
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
              )}
            </aside>
          </main>
        </div>

        {screen === "list" && (
          <div className="list-overlay">
            <WorkflowList workflows={list} onOpen={open} onNew={newWorkflow} />
          </div>
        )}
      </div>
    </div>
  );
}

function NavItem({ num, label, active, disabled, onClick }: { num: string; label: string; active: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button className={`nav__item ${active ? "nav__item--active" : ""}`} disabled={disabled} onClick={onClick} aria-current={active ? "page" : undefined}>
      <span className="nav__num">{num}</span>
      <span className="nav__label">{label}</span>
    </button>
  );
}

function StartedAgo({ startedAt, running }: { startedAt?: string; running: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running]);
  return <span className="subbar__started">started {timeAgo(startedAt ?? null)}</span>;
}
