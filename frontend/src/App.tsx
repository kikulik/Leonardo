import React, { useEffect, useRef, useState } from "react";
import DeviceCatalog from "./components/DeviceCatalog";
import { Canvas } from "./components/Canvas";
import AddEquipmentModal from "./components/AddEquipmentModal";
import { api } from "./lib/api";

import {
  addDevice,
  copySelectedDevices,
  pasteDevices,
  deleteSelectedDevices,
  saveProject,
  clampZoom,
  TYPE_PREFIX,
  type GraphState,
  type Device,
} from "./lib/editor";

type Mode = "select" | "pan" | "connect";

const LS_KEY = "leonardo.graph.v1";

export default function App() {
  // graph + selection
  const [graph, setGraph] = useState<GraphState>({ devices: [], connections: [] });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // UI state
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [mode, setMode] = useState<Mode>("select");

  // view
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // clipboard + history
  const [clipboard, setClipboard] = useState<Device[]>([]);
  const undoStack = useRef<GraphState[]>([]);
  const redoStack = useRef<GraphState[]>([]);

  // AI
  const [aiPrompt, setAiPrompt] = useState("");

  // add modal
  const [addOpen, setAddOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---------- helpers ----------
  const pushHistory = (state: GraphState) => {
    undoStack.current.push(state);
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
  };

  const updateGraph = (next: GraphState) => {
    setGraph((prev) => {
      pushHistory(prev);
      return next;
    });
  };

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

  // ---------- keyboard shortcuts ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Undo / Redo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (undoStack.current.length) {
          const prev = undoStack.current.pop()!;
          redoStack.current.push(graph);
          setGraph(prev);
          setSelectedIds(new Set());
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
        e.preventDefault();
        if (redoStack.current.length) {
          const nxt = redoStack.current.pop()!;
          undoStack.current.push(graph);
          setGraph(nxt);
          setSelectedIds(new Set());
        }
        return;
      }
      // Copy / Paste
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        e.preventDefault();
        setClipboard(copySelectedDevices(graph, selectedIds));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        e.preventDefault();
        if (!clipboard.length) return;
        updateGraph(pasteDevices(graph, clipboard));
        return;
      }
      // Delete
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedIds.size) {
          e.preventDefault();
          updateGraph(deleteSelectedDevices(graph, selectedIds));
          setSelectedIds(new Set());
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [graph, selectedIds, clipboard]);

  // ---------- Save / Load ----------
  const handleSaveFile = () => saveProject(graph, "project.json");
  const handleLoadFileChoose = () => fileInputRef.current?.click();
  const onFileChosen: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      setGraph(JSON.parse(text));
      setSelectedIds(new Set());
    } catch {
      alert("Failed to load file.");
    } finally {
      e.currentTarget.value = "";
    }
  };

  const resetView = () => {
    setPan({ x: 0, y: 0 });
    setZoom(1);
  };

  // ---------- Add Equipment ----------
  const handleAddSubmit = (p: {
    type: string; quantity: number; customNameBase?: string;
    manufacturer?: string; model?: string; w?: number; h?: number;
    inPorts?: { type: string; quantity: number };
    outPorts?: { type: string; quantity: number };
  }) => {
    const defaults: any[] = [];
    const addPorts = (kind: "IN" | "OUT", t?: string, qty?: number) => {
      const n = Math.max(0, qty || 0);
      for (let i = 1; i <= n; i++) {
        defaults.push({
          name: `${(t || "PORT").toUpperCase()}_${kind}_${i}`,
          type: (t || "GEN").toUpperCase(),
          direction: kind,
        });
      }
    };
    addPorts("IN", p.inPorts?.type, p.inPorts?.quantity);
    addPorts("OUT", p.outPorts?.type, p.outPorts?.quantity);

    updateGraph(
      addDevice(graph, {
        type: p.type,
        count: p.quantity || 1,
        customNameBase: p.customNameBase,
        w: p.w || 160,
        h: p.h || 80,
        manufacturer: p.manufacturer,
        model: p.model,
        defaultPorts: defaults,
      })
    );
    setAddOpen(false);
  };

  // ---------- Mock AI parser ----------
  const parseAi = (text: string) => {
    const t = text.trim().toLowerCase();
    // examples:
    //  "create 5 cameras"
    //  "router"
    //  "vision mixer 2"
    // map phrases -> type key used in TYPE_PREFIX
    const aliases: Record<string, string> = {
      camera: "camera",
      cameras: "camera",
      router: "router",
      "vision mixer": "vision mixer",
      mixer: "vision mixer",
      server: "server",
      "camera control unit": "camera control unit",
      ccu: "camera control unit",
      embeder: "embeder",
      embedder: "embeder",
      encoder: "encoder",
      "replay system": "replay system",
      replay: "replay system",
      monitor: "monitors",
      monitors: "monitors",
    };

    let qty = 1;
    const mQty = t.match(/(?:\bcreate\b|\badd\b)?\s*(\d+)\s+/);
    if (mQty) qty = Math.max(1, parseInt(mQty[1], 10));

    for (const k of Object.keys(aliases)) {
      if (t.includes(k)) {
        return { type: aliases[k], qty };
      }
    }
    // fallback: try last word
    const last = t.split(/\s+/).pop() || "device";
    return { type: aliases[last] || last, qty };
  };

  const runAi = async () => {
    const prompt = aiPrompt.trim();
    if (!prompt) return;

    // local mock: “create 5 cameras”, “router”, etc.
    const { type, qty } = parseAi(prompt);

    // default ports per some common types
    const defaults: Record<string, { in?: number; out?: number; portType?: string }> = {
      camera: { out: 2, portType: "SDI" },
      router: { in: 16, out: 16, portType: "SDI" },
      "vision mixer": { in: 8, out: 4, portType: "SDI" },
      server: { out: 2, in: 2, portType: "IP" },
      "camera control unit": { in: 1, out: 2, portType: "SDI" },
      embeder: { in: 2, out: 2, portType: "AUDIO" },
      encoder: { in: 2, out: 1, portType: "IP" },
      "replay system": { in: 6, out: 2, portType: "SDI" },
      monitors: { in: 2, out: 0, portType: "HDMI" },
    };
    const def = defaults[type] || { out: 1, in: 0, portType: "SDI" };

    const mkPorts = (kind: "IN" | "OUT", n = 0, typ = "SDI") =>
      Array.from({ length: n }).map((_, i) => ({
        name: `${typ.toUpperCase()}_${kind}_${i + 1}`,
        type: typ.toUpperCase(),
        direction: kind,
      }));

    const defaultPorts = [
      ...mkPorts("IN", def.in || 0, def.portType),
      ...mkPorts("OUT", def.out || 0, def.portType),
    ];

    updateGraph(
      addDevice(graph, {
        type,
        count: qty,
        defaultPorts,
      })
    );

    setAiPrompt("");
  };

  // ---------- toolbar actions ----------
  const handleCopy = () =>
    setClipboard(copySelectedDevices(graph, selectedIds));
  const handlePaste = () =>
    clipboard.length && updateGraph(pasteDevices(graph, clipboard));
  const handleDelete = () => {
    if (!selectedIds.size) return;
    updateGraph(deleteSelectedDevices(graph, selectedIds));
    setSelectedIds(new Set());
  };

  return (
    <div
      className="min-h-screen flex flex-col text-white"
      style={{ background: "linear-gradient(135deg, rgb(15,23,42) 0%, rgb(30,41,59) 100%)" }}
    >
      {/* Top bar */}
      <header className="h-14 shrink-0 border-b border-slate-700/60 px-4 flex items-center justify-between backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 grid place-items-center font-bold">L</div>
          <div className="font-semibold tracking-wide">Leonardo</div>
          <div className="ml-3 px-2 py-0.5 text-xs rounded bg-slate-800/70 border border-slate-700">Broadcast Schematic Editor</div>
        </div>
        <div className="text-xs text-slate-300">v0.5</div>
      </header>

      {/* Main content */}
      <div className="flex-1 min-h-0 grid grid-cols-[18rem,1fr,22rem] gap-0">
        {/* Left tools */}
        <aside className="border-r border-slate-700/60 p-4 overflow-y-auto">
          <h3 className="text-sm font-semibold text-slate-200 mb-3">Tools</h3>
          <div className="grid grid-cols-3 gap-2 mb-4">
            <button
              className={`px-3 py-2 rounded-lg text-sm ${mode === "select" ? "bg-blue-600" : "bg-slate-700 hover:bg-slate-600"}`}
              onClick={() => setMode("select")}
              title="Mouse (Select/Move)"
            >
              Mouse
            </button>
            <button
              className={`px-3 py-2 rounded-lg text-sm ${mode === "pan" ? "bg-blue-600" : "bg-slate-700 hover:bg-slate-600"}`}
              onClick={() => setMode("pan")}
              title="Pan View"
            >
              Pan
            </button>
            <button
              className={`px-3 py-2 rounded-lg text-sm ${mode === "connect" ? "bg-blue-600" : "bg-slate-700 hover:bg-slate-600"}`}
              onClick={() => setMode("connect")}
              title="Connect Ports"
            >
              Connect
            </button>
          </div>

          <h3 className="text-sm font-semibold text-slate-200 mb-3">Equipment</h3>
          <button
            className="w-full mb-3 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-medium transition-colors"
            onClick={() => setAddOpen(true)}
          >
            + Add Equipment
          </button>

          <div className="grid grid-cols-3 gap-2">
            <button className="bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded-lg text-sm" onClick={handleCopy} disabled={!selectedIds.size}>Copy</button>
            <button className="bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded-lg text-sm" onClick={handlePaste} disabled={!clipboard.length}>Paste</button>
            <button className="bg-red-600 hover:bg-red-700 px-3 py-2 rounded-lg text-sm" onClick={handleDelete} disabled={!selectedIds.size}>Delete</button>
          </div>

          <h3 className="text-sm font-semibold text-slate-200 mt-6 mb-3">Project</h3>
          <div className="grid grid-cols-2 gap-2">
            <button className="bg-green-700 hover:bg-green-800 px-3 py-2 rounded-lg text-sm" onClick={handleSaveFile}>Save (file)</button>
            <button className="bg-purple-700 hover:bg-purple-800 px-3 py-2 rounded-lg text-sm" onClick={handleLoadFileChoose}>Load (file)</button>
            <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={onFileChosen} />
          </div>

          <h3 className="text-sm font-semibold text-slate-200 mt-6 mb-3">View</h3>
          <div className="space-y-2">
            <button className="w-full bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded-lg text-sm" onClick={() => setShowGrid((v) => !v)}>
              {showGrid ? "Hide Grid" : "Show Grid"}
            </button>
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

        {/* Center canvas */}
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
          />
        </main>

        {/* Right properties */}
        <aside className="border-l border-slate-700/60 p-4 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-200">Properties</h3>
            <button onClick={() => setShowRightPanel((v) => !v)} className="text-slate-300 hover:text-white text-sm">
              {showRightPanel ? "Hide" : "Show"}
            </button>
          </div>

          {showRightPanel && (
            <div className="space-y-3">
              {selectedIds.size === 0 ? (
                <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-3 text-slate-400 text-sm">
                  Nothing selected. Ctrl/Cmd-click to multi-select. Use the Connect tool to link ports.
                </div>
              ) : (
                Array.from(selectedIds).map((id) => {
                  const d = graph.devices.find((x) => x.id === id)!;
                  const update = (patch: Partial<Device>) =>
                    setGraph((g) => ({
                      ...g,
                      devices: g.devices.map((x) => (x.id === id ? { ...x, ...patch } : x)),
                    }));

                  const addPort = (direction: "IN" | "OUT", type = "SDI") => {
                    const existing = d.ports ?? [];
                    const idx = existing.filter((p) => p.direction === direction).length + 1;
                    const name = `${type.toUpperCase()}_${direction}_${idx}`;
                    update({ ports: [...existing, { name, type: type.toUpperCase(), direction }] as any });
                  };
                  const delPort = (portName: string) =>
                    update({ ports: (d.ports ?? []).filter((p) => p.name !== portName) as any });
                  const updPort = (portName: string, patch: any) =>
                    update({
                      ports: (d.ports ?? []).map((p) =>
                        p.name === portName ? { ...p, ...patch, type: (patch.type ?? p.type)?.toUpperCase() } : p
                      ) as any,
                    });

                  return (
                    <div key={id} className="rounded-xl border border-slate-700 bg-slate-800/40 p-3 space-y-2">
                      <div className="text-slate-300 text-sm mb-1">{d.id}</div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-slate-400">Type</label>
                          <input className="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1"
                            value={d.type ?? ""} onChange={(e) => update({ type: e.target.value })} />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400">Manufacturer</label>
                          <input className="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1"
                            value={(d as any).manufacturer ?? ""} onChange={(e) => update({ manufacturer: e.target.value } as any)} />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400">Model</label>
                          <input className="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1"
                            value={(d as any).model ?? ""} onChange={(e) => update({ model: e.target.value } as any)} />
                        </div>

                        <div>
                          <label className="text-xs text-slate-400">Width</label>
                          <input type="number" min={80}
                            className="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1"
                            value={d.w ?? 160}
                            onChange={(e) => update({ w: parseInt(e.target.value || "160", 10) as any })} />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400">Height</label>
                          <input type="number" min={60}
                            className="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1"
                            value={d.h ?? 80}
                            onChange={(e) => update({ h: parseInt(e.target.value || "80", 10) as any })} />
                        </div>
                      </div>

                      <div className="flex items-center justify-between mt-2">
                        <div className="text-slate-300 text-sm">Ports</div>
                        <div className="flex gap-2">
                          <button className="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded" onClick={() => addPort("IN")}>+ IN</button>
                          <button className="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded" onClick={() => addPort("OUT")}>+ OUT</button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        {(d.ports ?? []).map((p) => (
                          <div key={p.name} className="grid grid-cols-12 gap-2 items-center">
                            <div className="col-span-4">
                              <input className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm"
                                value={p.name} onChange={(e) => updPort(p.name, { name: e.target.value })} />
                            </div>
                            <div className="col-span-3">
                              <input className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm"
                                value={p.type} onChange={(e) => updPort(p.name, { type: e.target.value })} />
                            </div>
                            <div className="col-span-3">
                              <select className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm"
                                value={p.direction} onChange={(e) => updPort(p.name, { direction: e.target.value as any })}>
                                <option value="IN">IN (left)</option>
                                <option value="OUT">OUT (right)</option>
                              </select>
                            </div>
                            <div className="col-span-2 text-right">
                              <button className="bg-red-600 hover:bg-red-700 text-xs px-2 py-1 rounded" onClick={() => delPort(p.name)}>Delete</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </aside>
      </div>

      {/* Bottom AI command bar */}
      <div className="ai-command-bar sticky bottom-0 left-0 right-0 bg-black/40 border-t border-slate-700/60 px-4 py-3">
        <div className="max-w-6xl mx-auto flex items-center gap-2">
          <input
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runAi()}
            placeholder='Try: "create 5 cameras", "router", "vision mixer 2"'
            className="flex-1 bg-slate-800/70 border border-slate-700 rounded-lg px-3 py-2 outline-none"
          />
          <button onClick={runAi} className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-medium">Run</button>
        </div>
      </div>

      {/* Add Equipment modal */}
      <AddEquipmentModal open={addOpen} onClose={() => setAddOpen(false)} onSubmit={handleAddSubmit} />
    </div>
  );
}
