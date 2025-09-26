import React, { useEffect, useRef, useState } from "react";
import AddEquipmentModal from "./components/AddEquipmentModal";
import {
  addDevice,
  copySelectedDevices,
  pasteDevices,
  deleteSelectedDevices,
  saveProject,
  clampZoom,
  type GraphState,
  type Device,
  type Port,
} from "./lib/editor";
import Canvas from "./components/Canvas";

type Mode = "select" | "pan" | "connect";
const LS_KEY = "leonardo.graph.v1";

export default function App() {
  const [graph, setGraph] = useState<GraphState>({ devices: [], connections: [] });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [showRightPanel, setShowRightPanel] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [mode, setMode] = useState<Mode>("select");

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const [clipboard, setClipboard] = useState<Device[]>([]);
  const undoStack = useRef<GraphState[]>([]);
  const redoStack = useRef<GraphState[]>([]);

  const [aiPrompt, setAiPrompt] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---------- load autosave ----------
  useEffect(() => {
    try {
      const txt = localStorage.getItem(LS_KEY);
      if (txt) setGraph(JSON.parse(txt));
    } catch { /* ignore */ }
  }, []);

  // ---------- autosave (debounced) ----------
  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(graph));
      } catch { /* ignore */ }
    }, 250);
    return () => clearTimeout(id);
  }, [graph]);

  const pushHistory = (state: GraphState) => {
    undoStack.current.push(state);
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
  };
  const updateGraph = (next: GraphState) =>
    setGraph((prev) => {
      pushHistory(prev);
      return next;
    });
  const onCanvasChange = (next: GraphState) => updateGraph(next);

  const toggleSelect = (id: string, additive: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (additive) {
        next.has(id) ? next.delete(id) : next.add(id);
      } else {
        next.clear();
        next.add(id);
      }
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
          pushHistory(graph);
          setGraph(next);
        }
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedIds.size) {
          updateGraph(deleteSelectedDevices(graph, selectedIds));
          setSelectedIds(new Set());
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        const copied = copySelectedDevices(graph, selectedIds);
        setClipboard(copied);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        const pasted = pasteDevices(graph, clipboard);
        updateGraph(pasted);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [graph, selectedIds, clipboard]);

  // ---------- add equipment ----------
  const handleAddSubmit = (payload: {
    type: string;
    quantity: number;
    customNameBase?: string;
    manufacturer?: string;
    model?: string;
    color?: string;
    w?: number;
    h?: number;
    inPorts?: { type: string; quantity: number };
    outPorts?: { type: string; quantity: number };
  }) => {
    const defaultPorts: Port[] = [];
    if (payload.inPorts) {
      for (let i = 0; i < (payload.inPorts.quantity || 0); i++) {
        defaultPorts.push({ name: `IN${i + 1}`, type: payload.inPorts.type, direction: "IN" });
      }
    }
    if (payload.outPorts) {
      for (let i = 0; i < (payload.outPorts.quantity || 0); i++) {
        defaultPorts.push({ name: `OUT${i + 1}`, type: payload.outPorts.type, direction: "OUT" });
      }
    }
    const next = addDevice(graph, {
      type: payload.type,
      count: payload.quantity,
      w: payload.w,
      h: payload.h,
      color: payload.color,
      customNameBase: payload.customNameBase,
      defaultPorts,
      manufacturer: payload.manufacturer,
      model: payload.model,
    });
    updateGraph(next);
    setAddOpen(false);
  };

  // ---------- update selected device in properties ----------
  const updateSelected = (partial: Partial<Device>) => {
    if (!selectedIds.size) return;
    const id = [...selectedIds][0];
    updateGraph({
      ...graph,
      devices: graph.devices.map((d) => (d.id === id ? { ...d, ...partial } : d)),
    });
  };
  const updatePort = (deviceId: string, portName: string, patch: Partial<Port>) => {
    updateGraph({
      ...graph,
      devices: graph.devices.map((d) => {
        if (d.id !== deviceId) return d;
        return {
          ...d,
          ports: d.ports.map((p) => (p.name === portName ? { ...p, ...patch } : p)),
        };
      }),
    });
  };
  const deletePort = (deviceId: string, portName: string) => {
    updateGraph({
      ...graph,
      devices: graph.devices.map((d) => {
        if (d.id !== deviceId) return d;
        return { ...d, ports: d.ports.filter((p) => p.name !== portName) };
      }),
      connections: graph.connections.filter(
        (c) =>
          !(
            (c.from.deviceId === deviceId && c.from.portName === portName) ||
            (c.to.deviceId === deviceId && c.to.portName === portName)
          )
      ),
    });
  };
  const addPort = (deviceId: string, dir: "IN" | "OUT") => {
    const dev = graph.devices.find((d) => d.id === deviceId);
    if (!dev) return;
    const base = dir === "IN" ? "IN" : "OUT";
    const idx = dev.ports.filter((p) => p.direction === dir).length + 1;
    updateGraph({
      ...graph,
      devices: graph.devices.map((d) =>
        d.id === deviceId
          ? { ...d, ports: [...d.ports, { name: `${base}${idx}`, type: "SDI", direction: dir }] }
          : d
      ),
    });
  };

  const selected = graph.devices.find((d) => selectedIds.has(d.id));

  return (
    <div className="w-screen h-screen bg-slate-950 text-slate-100 grid grid-cols-[1fr,320px]">
      <div className="relative">
        {/* Toolbar */}
        <div className="absolute top-3 left-3 z-10 flex gap-2 bg-slate-800/70 rounded-xl p-2 border border-slate-700/70">
          <button
            onClick={() => setMode("select")}
            className={`px-3 py-1 rounded ${mode === "select" ? "bg-blue-600" : "bg-slate-700 hover:bg-slate-600"}`}
          >
            Select
          </button>
          <button
            onClick={() => setMode("pan")}
            className={`px-3 py-1 rounded ${mode === "pan" ? "bg-blue-600" : "bg-slate-700 hover:bg-slate-600"}`}
          >
            Pan
          </button>
          <button
            onClick={() => setMode("connect")}
            className={`px-3 py-1 rounded ${mode === "connect" ? "bg-blue-600" : "bg-slate-700 hover:bg-slate-600"}`}
          >
            Connect
          </button>
          <label className="flex items-center gap-2 pl-2 border-l border-slate-600 ml-1">
            <input type="checkbox" checked={snapToGrid} onChange={(e) => setSnapToGrid(e.target.checked)} />
            <span className="text-sm">Snap to grid</span>
          </label>
          <label className="flex items-center gap-2 pl-2 border-l border-slate-600 ml-1">
            <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
            <span className="text-sm">Show grid</span>
          </label>
        </div>

        {/* Diagnostics */}
        <div className="absolute top-3 right-3 z-10 bg-slate-800/70 rounded-xl px-3 py-2 border border-slate-700/70 text-sm">
          <div>Devices: <b>{graph.devices.length}</b></div>
          <div>Connections: <b>{graph.connections.length}</b></div>
          <div>Zoom: {(zoom).toFixed(2)}</div>
        </div>

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
            if (v.zoom != null) setZoom(clampZoom(v.zoom));
            if (v.pan != null) setPan(v.pan);
          }}
          snapToGrid={snapToGrid}
        />

        {/* Bottom bar */}
        <div className="absolute bottom-3 left-3 z-10 flex gap-2">
          <button className="bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded" onClick={() => setAddOpen(true)}>
            + Add Equipment
          </button>
          <button className="bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded" onClick={() => saveProject(graph)}>
            Save JSON
          </button>
        </div>
      </div>

      {/* Right properties panel */}
      <aside className={`border-l border-slate-800 bg-slate-900 p-3 overflow-auto ${showRightPanel ? "" : "hidden"}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-lg font-semibold">Properties</div>
          <button
            className="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded"
            onClick={() => setShowRightPanel(!showRightPanel)}
          >
            {showRightPanel ? "Hide" : "Show"}
          </button>
        </div>

        {!selected ? (
          <div className="text-slate-400 text-sm">Select a device to edit its properties.</div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-xs text-slate-300">ID</div>
                <input className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1" value={selected.id} disabled />
              </div>
              <div>
                <div className="text-xs text-slate-300">Type</div>
                <input className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1" value={selected.type} disabled />
              </div>
              <div>
                <div className="text-xs text-slate-300">Name</div>
                <input className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1"
                  value={selected.customName ?? ""} onChange={(e) => updateSelected({ customName: e.target.value })} />
              </div>
              <div>
                <div className="text-xs text-slate-300">Color</div>
                <input type="color" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 h-[34px] p-1"
                  value={selected.color ?? "#1f2937"} onChange={(e) => updateSelected({ color: e.target.value })} />
              </div>
              <div>
                <div className="text-xs text-slate-300">Manufacturer</div>
                <input className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1"
                  value={selected.manufacturer ?? ""} onChange={(e) => updateSelected({ manufacturer: e.target.value })} />
              </div>
              <div>
                <div className="text-xs text-slate-300">Model</div>
                <input className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1"
                  value={selected.model ?? ""} onChange={(e) => updateSelected({ model: e.target.value })} />
              </div>
              <div>
                <div className="text-xs text-slate-300">Width</div>
                <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1"
                  value={selected.w} onChange={(e) => updateSelected({ w: parseInt(e.target.value || "160", 10) })} />
              </div>
              <div>
                <div className="text-xs text-slate-300">Height</div>
                <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1"
                  value={selected.h} onChange={(e) => updateSelected({ h: parseInt(e.target.value || "80", 10) })} />
              </div>
            </div>

            <div className="flex items-center justify-between mt-2">
              <div className="text-slate-300 text-sm">Ports</div>
              <div className="flex gap-2">
                <button className="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded" onClick={() => addPort(selected.id, "IN")}>+ IN</button>
                <button className="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded" onClick={() => addPort(selected.id, "OUT")}>+ OUT</button>
              </div>
            </div>

            <div className="space-y-2">
              {(selected.ports ?? []).map((p) => (
                <div key={p.name} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-4">
                    <input className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm"
                      value={p.name} onChange={(e) => updatePort(selected.id, p.name, { name: e.target.value })} />
                  </div>
                  <div className="col-span-3">
                    <input className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm"
                      value={p.type} onChange={(e) => updatePort(selected.id, p.name, { type: e.target.value })} />
                  </div>
                  <div className="col-span-3">
                    <select className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm"
                      value={p.direction}
                      onChange={(e) => updatePort(selected.id, p.name, { direction: e.target.value as any })}
                    >
                      <option value="IN">IN (left)</option>
                      <option value="OUT">OUT (right)</option>
                    </select>
                  </div>
                  <div className="col-span-2 text-right">
                    <button className="bg-red-600 hover:bg-red-700 text-xs px-2 py-1 rounded"
                      onClick={() => deletePort(selected.id, p.name)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* Modal */}
      <AddEquipmentModal open={addOpen} onClose={() => setAddOpen(false)} onSubmit={handleAddSubmit} />
    </div>
  );
}
