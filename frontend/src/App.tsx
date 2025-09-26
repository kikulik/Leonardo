import React, { useRef, useState } from "react";
import DeviceCatalog from "./components/DeviceCatalog";
import Chat from "./components/Chat";
import { Canvas } from "./components/Canvas";
import { api } from "./lib/api";

import {
  addDevice,
  addPortsToDevice,
  createConnection,
  editConnectionIds,
  copySelectedDevices,
  pasteDevices,
  deleteSelectedDevices,
  saveProject,
  loadProjectFromFile,
  clampZoom,
  type GraphState,
  type Device,
} from "./lib/editor";

/**
 * App shell + graph state:
 * - Generate via backend
 * - Select/drag (Canvas)
 * - Save/Load (file download/upload)
 * - Copy/Delete
 * - Grid toggle + Reset View
 * - Pan/Zoom (wheel to zoom, right-drag to pan)
 */

export default function App() {
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [aiPrompt, setAiPrompt] = useState("");
  const [graph, setGraph] = useState<GraphState>({
    devices: [],
    connections: [],
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);

  // view (pan/zoom) lives in App so buttons can control it
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // clipboard for copy/paste
  const [clipboard, setClipboard] = useState<Device[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- AI run ---
  const handleRunAi = async () => {
    const prompt = aiPrompt.trim();
    if (!prompt) return;

    try {
      const result = await api.generate(prompt); // POST /api/generate

      // Try to coerce into our GraphState shape if backend differs slightly
      const next: GraphState = {
        devices: (result.devices ?? result.nodes ?? []).map((d: any, i: number) => ({
          id: d.id ?? d.name ?? `DEV.${i + 1}`,
          type: d.type ?? d.role ?? "device",
          x: d.x ?? 0,
          y: d.y ?? 0,
          w: d.w ?? 160,
          h: d.h ?? 80,
          color: d.color,
          customName: d.customName,
          ports: d.ports ?? [],
        })),
        connections: (result.connections ?? result.links ?? []).map((c: any, i: number) => ({
          id: c.id ?? `CONN-${String(i + 1).padStart(4, "0")}`,
          from: {
            deviceId: c.from?.deviceId ?? c.source?.deviceId ?? c.source ?? "",
            portName: c.from?.portName ?? c.source?.portName ?? "",
          },
          to: {
            deviceId: c.to?.deviceId ?? c.target?.deviceId ?? c.target ?? "",
            portName: c.to?.portName ?? c.target?.portName ?? "",
          },
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

  // --- Toolbar actions ---
  const handleCopy = () => {
    if (!graph || !selectedId) return;
    const copied = copySelectedDevices(graph, new Set([selectedId]));
    setClipboard(copied);
  };

  const handlePaste = () => {
    if (!graph || clipboard.length === 0) return;
    setGraph((g) => pasteDevices(g, clipboard));
  };

  const handleDelete = () => {
    if (!graph || !selectedId) return;
    setGraph((g) => deleteSelectedDevices(g, new Set([selectedId])));
    setSelectedId(null);
  };

  const handleSave = () => {
    if (!graph) {
      alert("Nothing to save yet.");
      return;
    }
    saveProject(graph, "project.json");
  };

  const handleLoadClick = () => fileInputRef.current?.click();
  const handleFileChosen: React.ChangeEventHandler<HTMLInputElement> = async (
    e
  ) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const loaded = await loadProjectFromFile(f);
      setGraph(loaded);
      setSelectedId(null);
    } catch (err: any) {
      alert(err?.message || "Failed to load project.");
    } finally {
      e.currentTarget.value = "";
    }
  };

  const handleToggleGrid = () => setShowGrid((v) => !v);

  const handleResetView = () => {
    // drop x/y so Canvas auto-layouts again; also reset pan/zoom
    const devices = graph.devices.map(({ x, y, ...rest }) => rest as any);
    setGraph({ ...graph, devices });
    setSelectedId(null);
    setPan({ x: 0, y: 0 });
    setZoom(1);
  };

  // quick helpers to demo editor ops from left panel (optional)
  const demoAddCameras = () => {
    setGraph((g) =>
      addDevice(g, {
        type: "camera",
        count: 5,
        customNameBase: "Camera",
        defaultPorts: [
          { name: "SDI_OUT_1", type: "SDI", direction: "OUT" },
          { name: "CTRL_IN_1", type: "IP", direction: "IN" },
        ],
      })
    );
  };
  const demoConnectFirstTwo = () => {
    if (graph.devices.length < 2) {
      alert("Need at least 2 devices for demo connection.");
      return;
    }
    const a = graph.devices[0].id;
    const b = graph.devices[1].id;
    setGraph((g) => createConnection(g, { sourceDevice: a, destDevice: b }));
  };

  return (
    <div
      className="min-h-screen text-white"
      style={{
        background:
          "linear-gradient(135deg, rgb(15,23,42) 0%, rgb(30,41,59) 100%)",
      }}
    >
      {/* Top bar */}
      <header className="h-14 border-b border-slate-700/60 px-4 flex items-center justify-between backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 grid place-items-center font-bold">
            L
          </div>
          <div className="font-semibold tracking-wide">Leonardo</div>
          <div className="ml-3 px-2 py-0.5 text-xs rounded bg-slate-800/70 border border-slate-700">
            Broadcast Schematic Editor
          </div>
        </div>
        <div className="text-xs text-slate-300">v0.2</div>
      </header>

      {/* Body */}
      <div className="h-[calc(100vh-56px)] grid grid-cols-[20rem,1fr,22rem]">
        {/* Left tools */}
        <aside className="border-r border-slate-700/60 p-4 overflow-y-auto">
          <h3 className="text-sm font-semibold text-slate-200 mb-3">
            Equipment
          </h3>
          <button
            className="w-full mb-3 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-medium transition-colors"
            onClick={demoAddCameras}
          >
            + Add 5 Cameras (demo)
          </button>

          <div className="grid grid-cols-2 gap-2">
            <button
              className="bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded-lg text-sm"
              onClick={handleCopy}
              disabled={!selectedId}
              title={selectedId ? `Copy ${selectedId}` : "Select a device first"}
            >
              Copy
            </button>
            <button
              className="bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded-lg text-sm"
              onClick={handlePaste}
              disabled={clipboard.length === 0}
              title={
                clipboard.length ? "Paste clipboard" : "Copy something first"
              }
            >
              Paste
            </button>
            <button
              className="bg-red-600 hover:bg-red-700 px-3 py-2 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed col-span-2"
              onClick={handleDelete}
              disabled={!selectedId}
              title={selectedId ? `Delete ${selectedId}` : "Select a device first"}
            >
              Delete
            </button>
          </div>

          <h3 className="text-sm font-semibold text-slate-200 mt-6 mb-3">
            Project
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <button
              className="bg-green-600 hover:bg-green-700 px-3 py-2 rounded-lg text-sm"
              onClick={handleSave}
            >
              Save (download)
            </button>
            <button
              className="bg-purple-600 hover:bg-purple-700 px-3 py-2 rounded-lg text-sm"
              onClick={handleLoadClick}
            >
              Load (file)
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={handleFileChosen}
            />
          </div>

          <h3 className="text-sm font-semibold text-slate-200 mt-6 mb-3">
            View
          </h3>
          <div className="space-y-2">
            <button
              className="w-full bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded-lg text-sm"
              onClick={() => setShowGrid((v) => !v)}
            >
              {showGrid ? "Hide Grid" : "Show Grid"}
            </button>
            <button
              className="w-full bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded-lg text-sm"
              onClick={handleResetView}
              title="Re-layout devices & reset zoom/pan"
            >
              Reset View
            </button>
            <div className="grid grid-cols-3 gap-2">
              <button
                className="bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded-lg text-sm"
                onClick={() => setZoom((z) => clampZoom(z * 0.9))}
              >
                − Zoom
              </button>
              <div className="text-center text-xs text-slate-300 grid place-items-center">
                {Math.round(zoom * 100)}%
              </div>
              <button
                className="bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded-lg text-sm"
                onClick={() => setZoom((z) => clampZoom(z * 1.1))}
              >
                + Zoom
              </button>
            </div>
          </div>

          <h3 className="text-sm font-semibold text-slate-200 mt-6 mb-2">
            Device Catalog
          </h3>
          <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-3">
            <DeviceCatalog />
          </div>

          <h3 className="text-sm font-semibold text-slate-200 mt-6 mb-2">
            Chat (placeholder)
          </h3>
          <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-3">
            <Chat />
          </div>

          <h3 className="text-sm font-semibold text-slate-200 mt-6 mb-3">
            Demo links
          </h3>
          <div className="grid grid-cols-1 gap-2">
            <button
              className="bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded-lg text-sm"
              onClick={demoConnectFirstTwo}
            >
              Connect first two (demo)
            </button>
            <button
              className="bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded-lg text-sm"
              onClick={() =>
                setGraph((g) => editConnectionIds(g, { match: "CONN-", replace: "LINK-" }))
              }
            >
              Rename connection IDs (CONN- → LINK-)
            </button>
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
        <aside
          className={`border-l border-slate-700/60 p-4 overflow-y-auto transition-all duration-200 ${
            showRightPanel ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-200">Properties</h3>
            <button
              onClick={() => setShowRightPanel((v) => !v)}
              className="text-slate-300 hover:text-white text-sm"
            >
              {showRightPanel ? "Hide" : "Show"}
            </button>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-3">
              <div className="text-slate-300 text-sm mb-2">Selection</div>
              <div className="text-slate-400 text-sm">
                {selectedId ? (
                  <>
                    Selected: <span className="text-slate-200">{selectedId}</span>
                  </>
                ) : (
                  <>Nothing selected. Double-click a device to edit.</>
                )}
              </div>
            </div>
          </div>
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
          <button
            onClick={handleRunAi}
            className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-medium"
          >
            Run
          </button>
          <button
            onClick={() => setShowRightPanel((v) => !v)}
            className="bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded-lg"
            title="Toggle properties"
          >
            Panel
          </button>
        </div>
      </div>
    </div>
  );
}
