// frontend/src/App.tsx
import React, { useEffect, useRef, useState } from "react";
import DeviceCatalog from "./components/DeviceCatalog";
import { Canvas } from "./components/Canvas";
import AddEquipmentModal from "./components/AddEquipmentModal";

import {
  addDevice,
  copySelectedDevices,
  pasteDevices,
  deleteSelectedDevices,
  saveProject,
  clampZoom,
  withPortIds,
  type GraphState,
  type Device,
  type Port,
} from "./lib/editor";

type Mode = "select" | "pan" | "connect";
const LS_KEY = "leonardo.graph.v1";

function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = (el.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || (el as HTMLElement).isContentEditable === true;
}

export default function App() {
  const [graph, setGraph] = useState<GraphState>({ devices: [], connections: [] });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [showRightPanel, setShowRightPanel] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [mode, setMode] = useState<Mode>("select");

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const [clipboard, setClipboard] = useState<Device[]>([]);
  const undoStack = useRef<GraphState[]>([]);
  const redoStack = useRef<GraphState[]>([]);

  const [aiPrompt, setAiPrompt] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // load
  useEffect(() => {
    try {
      const txt = localStorage.getItem(LS_KEY);
      if (txt) setGraph(withPortIds(JSON.parse(txt)));
    } catch {}
  }, []);

  // autosave
  useEffect(() => {
    const id = window.setTimeout(() => {
      try { localStorage.setItem(LS_KEY, JSON.stringify(graph)); } catch {}
    }, 250);
    return () => clearTimeout(id);
  }, [graph]);

  const pushHistory = (state: GraphState) => {
    undoStack.current.push(state);
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
  };
  const updateGraph = (next: GraphState) => setGraph((prev) => { pushHistory(prev); return next; });
  const onCanvasChange = (next: GraphState) => updateGraph(next);

  const toggleSelect = (id: string, additive: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (additive) { next.has(id) ? next.delete(id) : next.add(id); }
      else { next.clear(); next.add(id); }
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());

  // keyboard (ignore when typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (undoStack.current.length) {
          const prev = undoStack.current.pop()!;
          redoStack.current.push(graph);
          setGraph(prev);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        if (redoStack.current.length) {
          const next = redoStack.current.pop()!;
          undoStack.current.push(graph);
          setGraph(next);
        }
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedIds.size) {
          updateGraph(deleteSelectedDevices(graph, selectedIds));
          setSelectedIds(new Set());
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [graph, selectedIds]);

  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  const onFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((txt) => {
      try { setGraph(withPortIds(JSON.parse(txt))); } catch {}
    });
  };

  // toolbar helpers
  const handleCopy = () => setClipboard(copySelectedDevices(graph, selectedIds));
  const handlePaste = () => clipboard.length && updateGraph(pasteDevices(graph, clipboard));
  const handleDelete = () => {
    if (!selectedIds.size) return;
    updateGraph(deleteSelectedDevices(graph, selectedIds));
    setSelectedIds(new Set());
  };

  // port helpers for properties panel (use stable id)
  const updatePortById = (devId: string, portId: string, patch: Partial<Port>) => {
    setGraph((g) => ({
      ...g,
      devices: g.devices.map((d) =>
        d.id !== devId ? d : { ...d, ports: d.ports.map((p) => (p.id === portId ? { ...p, ...patch, type: (patch.type ?? p.type)?.toUpperCase() } : p)) }
      ),
    }));
  };
  const addPort = (devId: string, dir: "IN" | "OUT", type = "SDI") => {
    setGraph((g) => ({
      ...g,
      devices: g.devices.map((d) =>
        d.id !== devId
          ? d
          : {
              ...d,
              ports: [
                ...d.ports,
                { id: crypto?.randomUUID?.() || Math.random().toString(36).slice(2), name: `${type.toUpperCase()}_${dir}_${d.ports.filter(p=>p.direction===dir).length + 1}`, type: type.toUpperCase(), direction: dir },
              ],
            }
      ),
    }));
  };
  const delPort = (devId: string, portId: string) => {
    setGraph((g) => ({
      ...g,
      devices: g.devices.map((d) =>
        d.id !== devId ? d : { ...d, ports: d.ports.filter((p) => p.id !== portId) }
      ),
    }));
  };

  // add device from modal
  const onModalSubmit = (p: {
    type: string; quantity: number; customNameBase?: string;
    manufacturer?: string; model?: string; w?: number; h?: number; color?: string;
    inPorts: { type: string; quantity: number };
    outPorts: { type: string; quantity: number };
  }) => {
    const mk = (dir: "IN" | "OUT", n = 0, t = "SDI") =>
      Array.from({ length: n }, (_, i) => ({ name: `${t.toUpperCase()}_${dir}_${i + 1}`, type: t.toUpperCase(), direction: dir }));
    const defaults = [...mk("IN", p.inPorts.quantity, p.inPorts.type), ...mk("OUT", p.outPorts.quantity, p.outPorts.type)];

    updateGraph(addDevice(graph, {
      type: p.type,
      count: p.quantity || 1,
      customNameBase: p.customNameBase,
      w: p.w || 160, h: p.h || 80,
      color: p.color || "#334155",
      manufacturer: p.manufacturer, model: p.model,
      defaultPorts: defaults,
    }));
    setAddOpen(false);
  };

  // quick-add from text bar (optional)
  const parseAi = (text: string) => {
    const t = text.trim().toLowerCase();
    const aliases: Record<string, string> = {
      camera: "camera", cameras: "camera",
      router: "router",
      "vision mixer": "vision mixer", mixer: "vision mixer",
      server: "server",
      "camera control unit": "camera control unit", ccu: "camera control unit",
      embeder: "embeder", embedder: "embeder",
      encoder: "encoder",
      "replay system": "replay system", replay: "replay system",
      monitor: "monitors", monitors: "monitors",
    };
    let qty = 1;
    const mQty = t.match(/(?:create|add)?\s*(\d+)\s+/);
    if (mQty) qty = Math.max(1, parseInt(mQty[1], 10));
    for (const k of Object.keys(aliases)) if (t.includes(k)) return { type: aliases[k], qty };
    const last = t.split(/\s+/).pop() || "device";
    return { type: aliases[last] || last, qty };
  };

  const runAi = () => {
    const { type, qty } = parseAi(aiPrompt);
    const defaults: Record<string, { in?: number; out?: number; portType?: string }> = {
      camera: { out: 2, portType: "SDI" },
      router: { in: 16, out: 16, portType: "SDI" },
      "vision mixer": { in: 8, out: 4, portType: "SDI" },
      server: { in: 2, out: 2, portType: "IP" },
      "camera control unit": { in: 1, out: 2, portType: "SDI" },
      embeder: { in: 2, out: 2, portType: "AUDIO" },
      encoder: { in: 2, out: 1, portType: "IP" },
      "replay system": { in: 6, out: 2, portType: "SDI" },
      monitors: { in: 2, out: 0, portType: "HDMI" },
    };
    const def = defaults[type] || { out: 1, in: 0, portType: "SDI" };
    const mk = (dir: "IN" | "OUT", n = 0, t = "SDI") =>
      Array.from({ length: n }, (_, i) => ({ name: `${t.toUpperCase()}_${dir}_${i + 1}`, type: t.toUpperCase(), direction: dir }));

    updateGraph(addDevice(graph, {
      type, count: qty, color: "#334155",
      defaultPorts: [...mk("IN", def.in || 0, def.portType), ...mk("OUT", def.out || 0, def.portType)],
    }));
    setAiPrompt("");
  };

  return (
    <div className="min-h-screen flex flex-col text-white" style={{ background: "linear-gradient(135deg, rgb(15,23,42) 0%, rgb(30,41,59) 100%)" }}>
      {/* Top */}
      <header className="h-14 shrink-0 border-b border-slate-700/60 px-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 grid place-items-center font-bold">L</div>
          <div className="font-semibold tracking-wide">Leonardo</div>
          <div className="ml-3 px-2 py-0.5 text-xs rounded bg-slate-800/70 border border-slate-700">Broadcast Schematic Editor</div>
        </div>
        <div className="text-xs text-slate-300">v0.9 • autosave</div>
      </header>

      {/* Body */}
      <div className="flex-1 min-h-0 grid grid-cols-[18rem,1fr,22rem]">
        {/* Left tools */}
        <aside className="border-r border-slate-700/60 p-4 overflow-y-auto">
          <h3 className="text-sm font-semibold text-slate-200 mb-3">Tools</h3>
          <div className="grid grid-cols-3 gap-2 mb-2">
            <button className={`px-3 py-2 rounded-lg text-sm ${mode === "select" ? "bg-blue-600" : "bg-slate-700 hover:bg-slate-600"}`} onClick={() => setMode("select")}>Mouse</button>
            <button className={`px-3 py-2 rounded-lg text-sm ${mode === "pan" ? "bg-blue-600" : "bg-slate-700 hover:bg-slate-600"}`} onClick={() => setMode("pan")}>Pan</button>
            <button className={`px-3 py-2 rounded-lg text-sm ${mode === "connect" ? "bg-blue-600" : "bg-slate-700 hover:bg-slate-600"}`} onClick={() => setMode("connect")}>Connect</button>
          </div>

          <div className="flex items-center justify-between mb-4">
            <label className="text-xs text-slate-300 flex items-center gap-2">
              <input type="checkbox" checked={snapEnabled} onChange={(e) => setSnapEnabled(e.target.checked)} />
              Snap to grid
            </label>
            <button className="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded" onClick={() => setShowGrid((v) => !v)}>
              {showGrid ? "Hide Grid" : "Show Grid"}
            </button>
          </div>

          <h3 className="text-sm font-semibold text-slate-200 mb-3">Equipment</h3>
          <button className="w-full mb-3 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-medium" onClick={() => setAddOpen(true)}>+ Add Equipment</button>

          <div className="grid grid-cols-3 gap-2">
            <button className="bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded-lg text-sm" onClick={handleCopy} disabled={!selectedIds.size}>Copy</button>
            <button className="bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded-lg text-sm" onClick={handlePaste} disabled={!clipboard.length}>Paste</button>
            <button className="bg-red-600 hover:bg-red-700 px-3 py-2 rounded-lg text-sm" onClick={handleDelete} disabled={!selectedIds.size}>Delete</button>
          </div>

          <h3 className="text-sm font-semibold text-slate-200 mt-6 mb-3">Project</h3>
          <div className="grid grid-cols-2 gap-2">
            <button className="bg-green-700 hover:bg-green-800 px-3 py-2 rounded-lg text-sm" onClick={() => saveProject(graph)}>Save (file)</button>
            <button className="bg-purple-700 hover:bg-purple-800 px-3 py-2 rounded-lg text-sm" onClick={() => fileInputRef.current?.click()}>Load (file)</button>
            <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={onFileChosen} />
          </div>

          <h3 className="text-sm font-semibold text-slate-200 mt-6 mb-3">View</h3>
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <button className="bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded-lg text-sm" onClick={() => setZoom((z) => clampZoom(z * 0.9))}>− Zoom</button>
              <div className="text-center text-xs text-slate-300 grid place-items-center">{Math.round(zoom * 100)}%</div>
              <button className="bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded-lg text-sm" onClick={() => setZoom((z) => clampZoom(z * 1.1))}>+ Zoom</button>
            </div>
            <button className="w-full bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded-lg text-sm" onClick={resetView}>Reset View</button>
          </div>

          <h3 className="text-sm font-semibold text-slate-200 mt-6 mb-2">Device Catalog</h3>
          <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-3">
            <DeviceCatalog />
          </div>
        </aside>

        {/* Canvas */}
        <main className="p-4 overflow-hidden flex flex-col">
          <Canvas
            graph={graph}
            selectedIds={selectedIds}
            mode={mode}
            onToggleSelect={toggleSelect}
            onClearSelection={clearSelection}
            onChange={onCanvasChange}
            showGrid={showGrid}
            zoom={zoom}
            pan={pan}
            onViewChange={(v) => {
              if (v.zoom !== undefined) setZoom(v.zoom);
              if (v.pan !== undefined) setPan(v.pan);
            }}
            snapEnabled={snapEnabled}
          />
        </main>

        {/* Properties (trimmed for brevity)… */}
      </div>
    </div>
  );
}
