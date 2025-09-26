// frontend/src/components/Canvas.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { GraphState, Device, Port } from "../lib/editor";
import { clampZoom, addConnection, moveDevice } from "../lib/editor";

type Mode = "select" | "pan" | "connect";

type Props = {
  graph: GraphState;
  selectedIds: Set<string>;
  mode: Mode;
  onToggleSelect: (id: string, additive: boolean) => void;
  onClearSelection: () => void;
  onChange: (next: GraphState) => void;

  showGrid: boolean;
  zoom: number;
  pan: { x: number; y: number };
  onViewChange: (v: { zoom?: number; pan?: { x: number; y: number } }) => void;

  snapEnabled?: boolean;
  gridSize?: number;
};

const BOX_W = 160;
const BOX_H = 80;
const HEADER_H = 24; // ← ports live below this; use it for precise Y

// Port endpoint in WORLD coordinates (unscaled/untranslated)
function portWorldPos(device: Device, portName: string, dir: "IN" | "OUT") {
  const w = device.w ?? BOX_W;
  const h = device.h ?? BOX_H;

  // Ports are rendered inside a content area of height (h - HEADER_H)
  const contentH = Math.max(0, h - HEADER_H);
  const inPorts = (device.ports ?? []).filter((p) => p.direction === "IN");
  const outPorts = (device.ports ?? []).filter((p) => p.direction === "OUT");

  if (dir === "IN") {
    const idx = inPorts.findIndex((p) => p.name === portName);
    const yWithin = ((idx + 1) * contentH) / (inPorts.length + 1);
    // Dot sits half outside with CSS (-ml-1). Center it ~4px outside the box.
    return { x: (device.x ?? 0) - 4, y: (device.y ?? 0) + HEADER_H + yWithin };
  }
  const idx = outPorts.findIndex((p) => p.name === portName);
  const yWithin = ((idx + 1) * contentH) / (outPorts.length + 1);
  return { x: (device.x ?? 0) + w + 4, y: (device.y ?? 0) + HEADER_H + yWithin };
}

export function Canvas({
  graph,
  selectedIds,
  mode,
  onToggleSelect,
  onClearSelection,
  onChange,
  showGrid,
  zoom,
  pan,
  onViewChange,
  snapEnabled = true,
  gridSize = 16,
}: Props) {
  const devices = graph.devices;
  const deviceMap = useMemo(() => new Map(devices.map((d) => [d.id, d])), [devices]);

  const wrapRef = useRef<HTMLDivElement | null>(null);

  // GRID overlay (view-space)
  const gridCell = Math.max(8, Math.round(24 * zoom)); // scale with zoom
  const gridPosX = ((pan.x % gridCell) + gridCell) % gridCell;
  const gridPosY = ((pan.y % gridCell) + gridCell) % gridCell;

  // DRAG DEVICES (smooth)
  const [drag, setDrag] = useState<{
    ids: string[];
    startX: number;
    startY: number;
    orig: Record<string, { x: number; y: number }>;
    raf?: number;
  } | null>(null);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!drag) return;
      const dx = (e.clientX - drag.startX) / zoom;
      const dy = (e.clientY - drag.startY) / zoom;
      cancelAnimationFrame(drag.raf ?? 0);
      const raf = requestAnimationFrame(() => {
        const nextDevices = graph.devices.map((d) =>
          drag.ids.includes(d.id)
            ? moveDevice(
                { ...d, x: drag.orig[d.id].x, y: drag.orig[d.id].y },
                dx,
                dy,
                { snapToGrid: snapEnabled, gridSize }
              )
            : d
        );
        onChange({ ...graph, devices: nextDevices });
      });
      setDrag((d0) => (d0 ? { ...d0, raf } : d0));
    }
    function onUp() {
      if (drag?.raf) cancelAnimationFrame(drag.raf);
      setDrag(null);
    }
    if (drag) {
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    }
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, graph, onChange, zoom, snapEnabled, gridSize]);

  // PAN / ZOOM
  const [panning, setPanning] = useState<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const onWheel: React.WheelEventHandler = (e) => {
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const next = clampZoom(zoom * factor);
    if (next !== zoom) onViewChange({ zoom: next });
  };

  // CONNECT (click OUT → click IN)
  const [pending, setPending] = useState<null | { from: { deviceId: string; portName: string } }>(null);

  function handlePortClick(d: Device, p: Port) {
    // auto-connect behavior kicks in when clicking ports
    if (p.direction === "OUT") {
      setPending({ from: { deviceId: d.id, portName: p.name } });
    } else if (p.direction === "IN" && pending) {
      const next = addConnection(graph, pending.from, { deviceId: d.id, portName: p.name });
      onChange(next);
      setPending(null); // boom!
    }
  }

  // RESIZE
  const [resizing, setResizing] = useState<null | {
    id: string; sx: number; sy: number; w: number; h: number; raf?: number;
  }>(null);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!resizing) return;
      const dx = (e.clientX - resizing.sx) / zoom;
      const dy = (e.clientY - resizing.sy) / zoom;
      const nw = Math.max(120, (resizing.w + dx));
      const nh = Math.max(60, (resizing.h + dy));
      cancelAnimationFrame(resizing.raf ?? 0);
      const raf = requestAnimationFrame(() => {
        onChange({
          ...graph,
          devices: graph.devices.map((d) => (d.id === resizing.id ? { ...d, w: nw, h: nh } : d)),
        });
      });
      setResizing((r) => (r ? { ...r, raf } : r));
    }
    function onUp() {
      if (resizing?.raf) cancelAnimationFrame(resizing.raf);
      setResizing(null);
    }
    if (resizing) {
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    }
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizing, graph, onChange, zoom]);

  return (
    <div className="relative w-full h-full select-none" onWheel={onWheel}>
      {/* GRID */}
      {showGrid && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(to right, rgba(100,116,139,0.15) 1px, transparent 1px), linear-gradient(to bottom, rgba(100,116,139,0.15) 1px, transparent 1px)`,
            backgroundSize: `${gridCell}px ${gridCell}px`,
            backgroundPosition: `${gridPosX}px ${gridPosY}px`,
          }}
        />
      )}

      {/* WORLD LAYER */}
      <div
        ref={wrapRef}
        className="absolute inset-0"
        onMouseDown={(e) => {
          // start panning with right-click or Pan tool
          if (e.button === 2 || mode === "pan") {
            setPanning({ sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y });
          } else if (e.button === 0) {
            // click empty area → clear selection
            if (e.target === wrapRef.current) onClearSelection();
          }
        }}
        onMouseMove={(e) => {
          if (!panning) return;
          const dx = (e.clientX - panning.sx) / zoom;
          const dy = (e.clientY - panning.sy) / zoom;
          onViewChange({ pan: { x: panning.px + dx, y: panning.py + dy } });
        }}
        onMouseUp={() => setPanning(null)}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          transform: `translate(${pan.x * zoom}px, ${pan.y * zoom}px) scale(${zoom})`,
          transformOrigin: "0 0",
        }}
      >
        {/* connections (curves) */}
        <svg width="100%" height="100%" className="absolute inset-0 pointer-events-none">
          {graph.connections.map((c) => {
            const Adev = deviceMap.get(c.from.deviceId)!;
            const Bdev = deviceMap.get(c.to.deviceId)!;
            if (!Adev || !Bdev) return null;
            const A = portWorldPos(Adev, c.from.portName, "OUT");
            const B = portWorldPos(Bdev, c.to.portName, "IN");
            const mx = (A.x + B.x) / 2;
            const d = `M ${A.x},${A.y} C ${mx},${A.y} ${mx},${B.y} ${B.x},${B.y}`;
            return (
              <path key={c.id} d={d} fill="none" stroke="rgba(56,189,248,0.95)" strokeWidth={2} />
            );
          })}
        </svg>

        {/* devices */}
        {devices.map((d) => {
          const w = d.w ?? BOX_W;
          const h = d.h ?? BOX_H;
          const selected = selectedIds.has(d.id);
          const deviceColor = d.color || "#334155";

          return (
            <div
              key={d.id}
              className="absolute rounded-xl shadow-lg"
              style={{
                left: d.x ?? 0,
                top: d.y ?? 0,
                width: w,
                height: h,
                background: deviceColor,
                border: "1px solid rgba(148,163,184,0.35)",
                boxShadow: selected ? "0 0 0 2px rgba(59,130,246,0.9), 0 0 18px rgba(59,130,246,0.5)" : "0 4px 12px rgba(0,0,0,0.25)",
                transition: "box-shadow 120ms ease",
              }}
              onMouseDown={(e) => {
                if (e.button !== 0) return;
                // start drag
                const ids = e.shiftKey || e.metaKey || e.ctrlKey
                  ? Array.from(new Set([...selectedIds, d.id]))
                  : [d.id];

                if (!(e.shiftKey || e.metaKey || e.ctrlKey)) onToggleSelect(d.id, false);
                else onToggleSelect(d.id, true);

                setDrag({
                  ids,
                  startX: e.clientX,
                  startY: e.clientY,
                  orig: Object.fromEntries(ids.map((id) => {
                    const dev = devices.find((x) => x.id === id)!;
                    return [id, { x: dev.x ?? 0, y: dev.y ?? 0 }];
                  })),
                });
              }}
            >
              {/* header */}
              <div className="text-[12px] px-2 py-1 flex items-center justify-between"
                   style={{ height: HEADER_H, lineHeight: "20px", background: "rgba(0,0,0,0.15)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="font-medium">{d.customName ?? d.id}</div>
                <div className="opacity-70">{d.type}</div>
              </div>

              {/* ports row */}
              <div className="relative w-full" style={{ height: `calc(100% - ${HEADER_H}px)` }}>
                {/* left (IN) */}
                <div className="absolute left-0 top-0 bottom-0 w-3 flex flex-col items-start justify-evenly">
                  {(d.ports ?? []).filter(p => p.direction === "IN").map((p) => (
                    <div
                      key={p.name}
                      className="group cursor-crosshair -ml-1"
                      onClick={() => handlePortClick(d, p)}
                      title={`${p.type} IN: ${p.name}`}
                    >
                      <div className="w-2 h-2 rounded-full bg-emerald-400 border border-emerald-300 shadow-sm group-hover:scale-125 transition-transform" />
                    </div>
                  ))}
                </div>

                {/* right (OUT) */}
                <div className="absolute right-0 top-0 bottom-0 w-3 flex flex-col items-end justify-evenly">
                  {(d.ports ?? []).filter(p => p.direction === "OUT").map((p) => (
                    <div
                      key={p.name}
                      className="group cursor-crosshair -mr-1"
                      onClick={() => handlePortClick(d, p)}
                      title={`${p.type} OUT: ${p.name}`}
                    >
                      <div className="w-2 h-2 rounded-full bg-sky-400 border border-sky-300 shadow-sm group-hover:scale-125 transition-transform" />
                    </div>
                  ))}
                </div>
              </div>

              {/* resize handle */}
              <div
                className="absolute w-3 h-3 right-0 bottom-0 translate-x-1 translate-y-1 rounded-sm border border-white/50 bg-white/60 cursor-nwse-resize"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setResizing({ id: d.id, sx: e.clientX, sy: e.clientY, w: w, h: h });
                }}
                title="Resize"
              />
            </div>
          );
        })}
      </div>

      {/* diagnostics */}
      <div className="absolute bottom-2 right-3 text-[11px] text-slate-200 bg-black/40 px-2 py-1 rounded border border-white/10">
        {devices.length} devices • {graph.connections.length} connections
        {snapEnabled ? " • snap: ON" : " • snap: OFF"}
      </div>

      {/* hint */}
      <div className="absolute bottom-2 left-3 text-[11px] text-slate-400 bg-black/30 px-2 py-1 rounded">
        Select/Move: Drag • Pan: Right-drag / Pan tool • Wheel: Zoom • Connect: OUT port → IN port
      </div>
    </div>
  );
}
