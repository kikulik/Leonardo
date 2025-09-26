// frontend/src/components/Canvas.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { GraphState, Device, Port } from "../lib/editor";
import { clampZoom, addConnection, moveDevice, getPorts, getPortById, findDevice } from "../lib/editor";

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
const HEADER_H = 36;
const PORT_D = 8;  // dot diameter
const PORT_R = PORT_D / 2;

// Center of the dot (what we draw the cable to)
function portCenter(device: Device, portId: string) {
  const w = device.w ?? BOX_W;
  const h = device.h ?? BOX_H;
  const port = getPortById(device, portId);
  if (!port) return { x: device.x ?? 0, y: device.y ?? 0 };
  const list = getPorts(device, port.direction);
  const idx = list.findIndex((p) => p.id === portId);
  const cy = (device.y ?? 0) + HEADER_H + ((idx + 1) * (h - HEADER_H)) / (list.length + 1);
  const cx =
    port.direction === "IN"
      ? (device.x ?? 0) + PORT_R            // inside the left edge
      : (device.x ?? 0) + w - PORT_R;       // inside the right edge
  return { x: cx, y: cy };
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
  const gridCell = Math.max(8, Math.round(24 * zoom));
  const gridPosX = ((pan.x % gridCell) + gridCell) % gridCell;
  const gridPosY = ((pan.y % gridCell) + gridCell) % gridCell;

  // DRAG DEVICES
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
  const [pending, setPending] = useState<null | { from: { deviceId: string; portId: string } }>(null);

  function handlePortClick(d: Device, p: Port) {
    if (p.direction === "OUT") {
      setPending({ from: { deviceId: d.id, portId: p.id } });
    } else if (p.direction === "IN" && pending) {
      const next = addConnection(graph, pending.from, { deviceId: d.id, portId: p.id });
      onChange(next);
      setPending(null);
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
          if (e.button === 2 || mode === "pan") {
            setPanning({ sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y });
          } else if (e.button === 0) {
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
        {/* connections */}
        <svg width="100%" height="100%" className="absolute inset-0 pointer-events-none">
          {graph.connections.map((c) => {
            const Adev = deviceMap.get(c.from.deviceId);
            const Bdev = deviceMap.get(c.to.deviceId);
            if (!Adev || !Bdev) return null;
            const A = portCenter(Adev, c.from.portId);
            const B = portCenter(Bdev, c.to.portId);
            const mx = (A.x + B.x) / 2;
            const d = `M ${A.x},${A.y} C ${mx},${A.y} ${mx},${B.y} ${B.x},${B.y}`;
            return <path key={c.id} d={d} fill="none" stroke="rgba(56,189,248,0.95)" strokeWidth={2} />;
          })}
        </svg>

        {/* devices */}
        {devices.map((d) => {
          const w = d.w ?? BOX_W;
          const h = d.h ?? BOX_H;
          const selected = selectedIds.has(d.id);
          const color = d.color || "#334155";
          const INs = getPorts(d, "IN");
          const OUTs = getPorts(d, "OUT");

          const vCenter = (idx: number, total: number) =>
            HEADER_H + ((idx + 1) * (h - HEADER_H)) / (total + 1);

          return (
            <div
              key={d.id}
              className="absolute rounded-xl shadow-lg"
              style={{
                left: d.x ?? 0,
                top: d.y ?? 0,
                width: w,
                height: h,
                background: color,
                border: "1px solid rgba(148,163,184,0.35)",
                boxShadow: selected ? "0 0 0 2px rgba(59,130,246,0.9), 0 0 18px rgba(59,130,246,0.5)" : "0 4px 12px rgba(0,0,0,0.25)",
                transition: "box-shadow 120ms ease",
              }}
              onMouseDown={(e) => {
                if (e.button !== 0) return;
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
              <div className="px-2 py-1.5 border-b border-white/10" style={{ background: "rgba(0,0,0,0.15)", height: HEADER_H }}>
                <div className="text-[12px] flex items-center justify-between">
                  <div className="font-medium truncate">{d.customName ?? d.id}</div>
                  <div className="opacity-70 ml-2 truncate">{d.type}</div>
                </div>
                <div className="text-[10px] opacity-85 mt-0.5 truncate">
                  {d.manufacturer || ""}{(d.manufacturer && d.model) ? " • " : ""}{d.model || ""}
                </div>
              </div>

              {/* left (IN) pins */}
              {INs.map((p, idx) => {
                const cy = vCenter(idx, INs.length);
                return (
                  <div key={p.id}>
                    <div
                      title={`${p.type} IN: ${p.name}`}
                      className="absolute cursor-crosshair"
                      style={{
                        left: 0,                 // fully inside the box
                        top: cy - PORT_R,
                        width: PORT_D, height: PORT_D,
                      }}
                      onClick={(e) => { e.stopPropagation(); handlePortClick(d, p); }}
                    >
                      <div className="w-full h-full rounded-full border border-emerald-300 bg-emerald-400 shadow-sm" />
                    </div>
                    {/* label to the right */}
                    <div
                      className="absolute text-[10px] leading-none text-white/90"
                      style={{ left: PORT_D + 4, top: cy - 6 }}
                    >
                      {p.name}
                    </div>
                  </div>
                );
              })}

              {/* right (OUT) pins */}
              {OUTs.map((p, idx) => {
                const cy = vCenter(idx, OUTs.length);
                return (
                  <div key={p.id}>
                    <div
                      title={`${p.type} OUT: ${p.name}`}
                      className="absolute cursor-crosshair"
                      style={{
                        left: w - PORT_D,       // fully inside the box
                        top: cy - PORT_R,
                        width: PORT_D, height: PORT_D,
                      }}
                      onClick={(e) => { e.stopPropagation(); handlePortClick(d, p); }}
                    >
                      <div className="w-full h-full rounded-full border border-sky-300 bg-sky-400 shadow-sm" />
                    </div>
                    {/* label to the left */}
                    <div
                      className="absolute text-[10px] leading-none text-white/90 text-right"
                      style={{ right: PORT_D + 4, top: cy - 6, width: Math.max(40, w / 3) }}
                    >
                      {p.name}
                    </div>
                  </div>
                );
              })}

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
        {devices.length} devices • {graph.connections.length} connections {snapEnabled ? "• snap: ON" : "• snap: OFF"}
      </div>

      {/* hint */}
      <div className="absolute bottom-2 left-3 text-[11px] text-slate-400 bg-black/30 px-2 py-1 rounded">
        Select/Move: Drag • Pan: Right-drag / Pan tool • Wheel: Zoom • Connect: OUT port → IN port
      </div>
    </div>
  );
}
