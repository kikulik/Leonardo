import React, { useRef, useState } from "react";
import DeviceCatalog from "./components/DeviceCatalog";
import Chat from "./components/Chat";
import { Canvas } from "./components/Canvas";
import { api } from "./lib/api";
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
} from "./lib/editor";

/**
 * v0.4
 * - Boxes show Device ID (e.g., CAM.01)
 * - Copy/Paste auto-increments ID by type (CAM.02…)
 * - OUT→IN port linking on Canvas
 */

const LS_KEY = "leonardo.graph.v1";

export default function App() {
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [aiPrompt, setAiPrompt] = useState("");
  const [graph, setGraph] = useState<GraphState>({ devices: [], connections: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);

  // Add modal
  const [addOpen, setAddOpen] = useState(false);

  // view (pan/zoom)
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // clipboard for copy/paste
  const [clipboard, setClipboard] = useState<Device[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- AI run (unchanged; normalize if needed) ---
  const handleRunAi = async () => {
    const prompt = aiPrompt.trim();
    if (!prompt) return;
    try {
      const result = await api.generate(prompt);
      const next: GraphState = {
        devices: (result.devices ?? result.nodes ?? []).map((d: any, i: number) => ({
          id: d.id ?? d.name ?? `DEV.${i + 1}`,
          type: d.type ?? d.role ?? "device",
          manufacturer: d.manufacturer,
          model: d.model,
          customName: d.customName,
          x: d.x ?? 0, y: d.y ?? 0,
          w: d.w ?? 160, h: d.h ?? 80,
          color: d.color,
          ports: d.ports ?? [],
        })),
        connections: (result.connections ?? result.links ?? []).map((c: any, i: number) => ({
          id: c.id ?? `CONN-${String(i + 1).padStart(4, "0")}`,
          from: { deviceId: c.from?.deviceId ?? c.source ?? "", portName: c.from?.portName ?? "" },
          to:   { deviceId: c.to?.deviceId ?? c.target ?? "", portName: c.to?.portName ?? "" },
        })),
      };
      console.log("GENERATE result (normalized):", next);
      setGraph(next);
      setSelectedId(null);
      alert("Generate OK. Check console for JSON.");
    } catch (err: any) {
      console.error(err);
      alert(`Generate failed: ${err.message || err}`);
    } finally {
      setAiPrompt("");
    }
  };

  // --- Canvas change handler (dragging updates x/y, etc.) ---
  const handleGraphChange = (next: GraphState) => setGraph(next);

  // --- Add Equipment submit ---
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

    setGraph((g) =>
      addDevice(g, {
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

  // --- Toolbar actions ---
  const handleCopy = () => {
    if (!selectedId) return;
    setClipboard(copySelectedDevices(graph, new Set([selectedId])));
  };

  const handlePaste = () => {
    if (!clipboard.length) return;
    // IDs will auto-increment by type on paste
    setGraph((g) => pasteDevices(g, clipboard));
  };

  const handleDelete = () => {
    if (!selectedId) return;
    setGraph((g) => deleteSelectedDevices(g, new Set([selectedId])));
    setSelectedId(null);
  };

  const handleSaveFile = () => saveProject(graph, "project.json");
  const handleLoadFileChoose = () => fileInputRef.current?.click();
  const onFileChosen: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      setGraph(JSON.parse(text));
      setSelectedId(null);
    } catch {
      alert("Failed to load file.");
    } finally {
      e.currentTarget.value = "";
    }
  };

  const handleResetView = () => {
    const devices = graph.devices.map(({ x, y, ...rest }) => rest as any);
    setGraph({ ...graph, devices });
    setSelectedId(null);
    setPan({ x: 0, y: 0 });
    setZoom(1);
  };

  // --- Properties panel (selected device) ---
  const sel = selectedId ? graph.devices.find((d) => d.id === selectedId) : null;

  const updateSelectedDevice = (patch: Partial<Device>) => {
    if (!sel) return;
    setGraph((g) => ({
      ...g,
      devices: g.devices.map((d) => (d.id === sel.id ? { ...d, ...patch } : d)),
    }));
  };

  const addPort = (direction: "IN" | "OUT", type = "SDI") => {
    if (!sel) return;
    const existing = sel.ports ?? [];
    const idx = existing.filter((p) => p.direction === direction).length + 1;
    const name = `${type.toUpperCase()}_${direction}_${idx}`;
    const nextPorts = [...existing, { name, type: type.toUpperCase(), direction }];
    updateSelectedDevice({ ports: nextPorts as any });
  };
  const deletePort = (portName: string) => {
    if (!sel) return;
    const nextPorts = (sel.ports ?? []).filter((p) => p.name !== portName);
    updateSelectedDevice({ ports: nextPorts as any });
  };
  const updatePort = (portName: string, patch: Partial<{ name: string; type: string; direction: "IN" | "OUT" }>) => {
    if (!sel) return;
    const nextPorts = (sel.ports ?? []).map((p) =>
      p.name === portName ? { ...p, ...patch, type: (patch.type ?? p.type)?.toUpperCase() } : p
    );
    updateSelectedDevice({ ports: nextPorts as any });
  };

  return (
    <div
      className="min-h-screen text-white"
      style={{ background: "linear-gradient(135deg, rgb(15,23,42) 0%, rgb(30,41,59) 100%)" }}
    >
      {/* Top bar */}
      <header className="h-14 border-b border-slate-700/60 px-4 flex items-center justify-between backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 grid place-items-center font-bold">L</div>
          <div className="font-semibold tracking-wide">Leonardo</div>
          <div className="ml-3 px-2 py-0.5 text-xs rounded bg-slate-800/70 border border-slate-700">Broadcast Schematic Editor</div>
        </div>
        <div className="text-xs text-slate-300">v0.4</div>
      </header>

      {/* Body */}
      <div className="h:[calc(100vh-56px)] grid grid-cols-[20rem,1fr,22rem]">
        {/* Left tools */}
        <aside className="border-r border-slate-700/60 p-4 overflow-y-auto">
          <h3 className="text-sm font-semibold text-slate-200 mb-3">Equipment</h3>
          <button
            className="w-full mb-3 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-medium transition-colors"
            onClick={() => setAddOpen(true)}
          >
            + Add Equipment
          </button>

          <div className="grid grid-cols-3 gap-2">
            <button className="bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded-lg text-sm" onClick={handleCopy} disabled={!selectedId}>Copy</button>
            <button className="bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded-lg text-sm" onClick={handlePaste} disabled={!clipboard.length}>Paste</button>
            <button className="bg-red-600 hover:bg-red-700 px-3 py-2 rounded-lg text-sm" onClick={handleDelete} disabled={!selectedId}>Delete</button>
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
            <button className="w-full bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded-lg text-sm" onClick={handleResetView}>Reset View</button>
          </div>

          <h3 className="text-sm font-semibold text-slate-200 mt-6 mb-2">Device Catalog</h3>
          <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-3">
            <DeviceCatalog />
          </div>

          <h3 className="text-sm font-semibold text-slate-200 mt-6 mb-2">Chat</h3>
          <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-3">
            <Chat />
          </div>
        </aside>

        {/* Center canvas */}
        <main className="relative">
          <div className="absolute inset-0">
            <Canvas
              graph={graph}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onChange={handleGraphChange}
              showGrid={showGrid}
              zoom={zoom}
              pan={pan}
              onViewChange={(v) => {
                if (v.zoom !== undefined) setZoom(v.zoom);
                if (v.pan !== undefined) setPan(v.pan);
              }}
            />
          </div>
        </main>

        {/* Right properties (collapsible) */}
        <aside className="border-l border-slate-700/60 p-4 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-200">Properties</h3>
            <button onClick={() => setShowRightPanel((v) => !v)} className="text-slate-300 hover:text-white text-sm">
              {showRightPanel ? "Hide" : "Show"}
            </button>
          </div>

          {showRightPanel && (
            <div className="space-y-3">
              {!sel ? (
                <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-3 text-slate-400 text-sm">
                  Nothing selected. Click a device.
                </div>
              ) : (
                <>
                  <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-3 space-y-2">
                    <div className="text-slate-300 text-sm mb-1">Device</div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-xs text-slate-400 col-span-2">ID</label>
                      <div className="col-span-2 text-slate-200 text-sm">{sel.id}</div>

                      <div>
                        <label className="text-xs text-slate-400">Type</label>
                        <input className="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1"
                          value={sel.type ?? ""} onChange={(e) => updateSelectedDevice({ type: e.target.value })} />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400">Manufacturer</label>
                        <input className="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1"
                          value={(sel as any).manufacturer ?? ""} onChange={(e) => updateSelectedDevice({ manufacturer: e.target.value } as any)} />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400">Model</label>
                        <input className="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1"
                          value={(sel as any).model ?? ""} onChange={(e) => updateSelectedDevice({ model: e.target.value } as any)} />
                      </div>

                      <div>
                        <label className="text-xs text-slate-400">Width</label>
                        <input type="number" min={80}
                          className="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1"
                          value={sel.w ?? 160}
                          onChange={(e) => updateSelectedDevice({ w: parseInt(e.target.value || "160", 10) as any })} />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400">Height</label>
                        <input type="number" min={60}
                          className="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1"
                          value={sel.h ?? 80}
                          onChange={(e) => updateSelectedDevice({ h: parseInt(e.target.value || "80", 10) as any })} />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-slate-300 text-sm">Ports</div>
                      <div className="flex gap-2">
                        <button className="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded"
                          onClick={() => addPort("IN")}>+ IN</button>
                        <button className="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded"
                          onClick={() => addPort("OUT")}>+ OUT</button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {(sel.ports ?? []).map((p) => (
                        <div key={p.name} className="grid grid-cols-12 gap-2 items-center">
                          <div className="col-span-4">
                            <input className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm"
                              value={p.name}
                              onChange={(e) => updatePort(p.name, { name: e.target.value })} />
                          </div>
                          <div className="col-span-3">
                            <input className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm"
                              value={p.type}
                              onChange={(e) => updatePort(p.name, { type: e.target.value })} />
                          </div>
                          <div className="col-span-3">
                            <select className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm"
                              value={p.direction}
                              onChange={(e) => updatePort(p.name, { direction: e.target.value as any })}>
                              <option value="IN">IN (left)</option>
                              <option value="OUT">OUT (right)</option>
                            </select>
                          </div>
                          <div className="col-span-2 text-right">
                            <button className="bg-red-600 hover:bg-red-700 text-xs px-2 py-1 rounded"
                              onClick={() => deletePort(p.name)}>Delete</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </aside>
      </div>

      {/* Bottom AI command bar */}
      <div className="ai-command-bar fixed bottom-0 left-0 right-0 bg-black/40 border-t border-slate-700/60 px-4 py-3">
        <div className="max-w-6xl mx-auto flex items-center gap-2">
          <input
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleRunAi()}
            placeholder='Type a command, e.g. "add 5 cameras"'
            className="flex-1 bg-slate-800/70 border border-slate-700 rounded-lg px-3 py-2 outline-none"
          />
          <button onClick={handleRunAi} className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-medium">Run</button>
        </div>
      </div>

      {/* Add Equipment modal */}
      <AddEquipmentModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={handleAddSubmit}
      />
    </div>
  );
}
