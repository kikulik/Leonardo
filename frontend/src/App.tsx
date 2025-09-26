import React, { useState } from "react";
import DeviceCatalog from "./components/DeviceCatalog";
import Chat from "./components/Chat";
import { Canvas } from "./components/Canvas";
import { api } from "./lib/api";

/**
 * Pro UI shell:
 * - Dark gradient background
 * - Left tools sidebar
 * - Center canvas area (renders graph JSON)
 * - Right properties panel (collapsible)
 * - Bottom AI command bar
 */

export default function App() {
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [aiPrompt, setAiPrompt] = useState("");
  const [graph, setGraph] = useState<any>(null); // holds { devices, connections? }
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // --- AI run ---
  const handleRunAi = async () => {
    const prompt = aiPrompt.trim();
    if (!prompt) return;

    try {
      // Call backend /generate via Nginx proxy (/api/generate)
      const result = await api.generate(prompt);

      console.log("GENERATE result:", result);
      setGraph(result); // render on canvas
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
  const handleGraphChange = (next: any) => {
    setGraph(next);
  };

  // --- Toolbar actions ---
  let copySeq = 1;
  const handleCopy = () => {
    if (!graph || !selectedId) return;
    const orig = graph.devices.find((d: any) => d.id === selectedId);
    if (!orig) return;
    const clone = {
      ...orig,
      id: `${orig.id}_copy${copySeq++}`,
      x: (orig.x ?? 0) + 24,
      y: (orig.y ?? 0) + 24,
    };
    setGraph({ ...graph, devices: [...graph.devices, clone] });
    setSelectedId(clone.id);
  };

  const handleDelete = () => {
    if (!graph || !selectedId) return;
    const devices = graph.devices.filter((d: any) => d.id !== selectedId);
    const connections = (graph.connections ?? []).filter(
      (c: any) => c.from.deviceId !== selectedId && c.to.deviceId !== selectedId
    );
    setGraph({ ...graph, devices, connections });
    setSelectedId(null);
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
        <div className="text-xs text-slate-300">
          v0.1 • mock UI (we’ll wire APIs next)
        </div>
      </header>

      {/* Body */}
      <div className="h-[calc(100vh-56px)] grid grid-cols-[20rem,1fr,22rem]">
        {/* Left tools */}
        <aside className="border-r border-slate-700/60 p-4 overflow-y-auto">
          <h3 className="text-sm font-semibold text-slate-200 mb-3">
            Equipment
          </h3>
          <button className="w-full mb-3 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-medium transition-colors">
            + Add Equipment
          </button>

          <div className="grid grid-cols-2 gap-2">
            <button
              className="bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded-lg text-sm"
              onClick={handleCopy}
              disabled={!graph || !selectedId}
              title={selectedId ? `Copy ${selectedId}` : "Select a device first"}
            >
              Copy
            </button>
            <button
              className="bg-red-600 hover:bg-red-700 px-3 py-2 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleDelete}
              disabled={!graph || !selectedId}
              title={selectedId ? `Delete ${selectedId}` : "Select a device first"}
            >
              Delete
            </button>
          </div>

          <h3 className="text-sm font-semibold text-slate-200 mt-6 mb-3">
            Project
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <button className="bg-green-600 hover:bg-green-700 px-3 py-2 rounded-lg text-sm">
              Save
            </button>
            <button className="bg-purple-600 hover:bg-purple-700 px-3 py-2 rounded-lg text-sm">
              Load
            </button>
          </div>

          <h3 className="text-sm font-semibold text-slate-200 mt-6 mb-3">
            View
          </h3>
          <div className="space-y-2">
            <button className="w-full bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded-lg text-sm">
              Toggle Grid
            </button>
            <button className="w-full bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded-lg text-sm">
              Reset View
            </button>
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
        </aside>

        {/* Center canvas */}
        <main className="relative">
          <div className="absolute inset-0">
            <Canvas
              graph={graph}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onChange={handleGraphChange}
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
                  <>Selected: <span className="text-slate-200">{selectedId}</span></>
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
