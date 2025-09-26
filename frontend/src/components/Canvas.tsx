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
// BODY ONLY (no header in these numbers)
const BOX_H = 80;

const HEADER_H = 36; // visual-only cap rendered above body

// Pin geometry (inside body only)
const PIN_INSET = 7;
const PORT_FONT = 10;
const BODY_PAD_TOP = 15;
const BODY_PAD_BOTTOM = 15;

/** Evenly distribute pins with equal top/bottom margins (no header in math). */
function pinYLocalBody(bodyH: number, count: number, idx: number): number {
  const innerTop = BODY_PAD_TOP;
  const innerH = Math.max(0, bodyH - (BODY_PAD_TOP + BODY_PAD_BOTTOM));
  if (count <= 0) return innerTop + innerH / 2;
  const step = innerH / (count + 1);           // equal margins
  return innerTop + step * (idx + 1);
}

/** World position for a port (BODY coords only) */
function portWorldPos(device: Device, portName: string, dir: "IN" | "OUT") {
  const w = device.w ?? BOX_W;
  const h = device.h ?? BOX_H;
  const INs = (device.ports ?? []).filter((p) => p.direction === "IN");
  const OUTs = (device.ports ?? []).filter((p) => p.direction === "OUT");

  if (dir === "IN") {
    const idx = INs.findIndex((p) => p.name === portName);
    if (idx === -1) return { x: device.x ?? 0, y: device.y ?? 0 };
    return { x: (device.x ?? 0) + PIN_INSET, y: (device.y ?? 0) + pinYLocalBody(h, INs.length, idx) };
  } else {
    const idx = OUTs.findIndex((p) => p.name === portName);
    if (idx === -1) return { x: device.x ?? 0, y: device.y ?? 0 };
    return { x: (device.x ?? 0) + w - PIN_INSET, y: (device.y ?? 0) + pinYLocalBody(h, OUTs.length, idx) };
  }
}

/** Minimum BODY size (no header here) */
function minBodySizeForDevice(d: Device) {
  const INs = (d.ports ?? []).filter((p) => p.direction === "IN");
  const OUTs = (d.ports ?? []).filter((p) => p.direction === "OUT");
  const maxPorts = Math.max(INs.length, OUTs.length);

  // ensure room for (count+1) spacing
  const minPortSpacing = 24;
  const minInnerHeight = maxPorts > 0 ? (maxPorts + 1) * minPortSpacing : 20;
  const minH = Math.max(80, BODY_PAD_TOP + BODY_PAD_BOTTOM + minInnerHeight);

  // width rough for labels both sides + pins + middle gap
  const CHAR_W = Math.ceil(PORT_FONT * 0.6);
  const leftLen = INs.reduce((m, p) => Math.max(m, (p.name || "").length), 0);
  const rightLen = OUTs.reduce((m, p) => Math.max(m, (p.name || "").length), 0);
  const MIDDLE_GAP = 24;
  const PIN_AND_TEXT = 2 * (PIN_INSET + 9);
  const minW = Math.max(160, PIN_AND_TEXT + leftLen * CHAR_W + rightLen * CHAR_W + MIDDLE_GAP);

  return { minW, minH };
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
  const deviceMap = useMemo(() => new Map(devices.map((d) => [d.id, d] as const)), [devices]);

  const wrapRef = useRef<HTMLDivElement | null>(null);

  // track wrapper size so connection SVG never clips
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const ro = new ResizeObserver(() => setCanvasSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setCanvasSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Grid
  const gridCell = Math.max(8, Math.round(24 * zoom));
  const gridPosX = ((pan.x % gridCell) + gridCell) % gridCell;
  const gridPosY = ((pan.y % gridCell) + gridCell) % gridCell;

  // Drag devices
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
        const next: GraphState = {
          ...graph,
          devices: graph.devices.map((d) => {
            if (!drag.ids.includes(d.id)) return d;
            const start = drag.orig[d.id];
            return moveDevice({ ...d, x: start.x, y: start.y }, dx, dy, { snapToGrid: snapEnabled, gridSize });
          }),
        };
        onChange(next);
      });
      setDrag((r) => (r ? { ...r, raf } : r));
    }
    function onUp() { if (drag?.raf) cancelAnimationFrame(drag.raf); setDrag(null); }
    if (drag) { window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp); }
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [drag, graph, onChange, zoom, snapEnabled, gridSize]);

  // Resize BODY
  const [resizing, setResizing] = useState<null | { id: string; sx: number; sy: number; w: number; h: number; raf?: number }>(null);
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!resizing) return;
      const dx = (e.clientX - resizing.sx) / zoom;
      const dy = (e.clientY - resizing.sy) / zoom;
      cancelAnimationFrame(resizing.raf ?? 0);
      const raf = requestAnimationFrame(() => {
        const next: GraphState = {
          ...graph,
          devices: graph.devices.map((d) => {
            if (d.id !== resizing.id) return d;
            const { minW, minH } = minBodySizeForDevice(d);
            return { ...d, w: Math.max(minW, Math.round(resizing.w + dx)), h: Math.max(minH, Math.round(resizing.h + dy)) };
          }),
        };
        onChange(next);
      });
      setResizing((r) => (r ? { ...r, raf } : r));
    }
    function onUp() { if (resizing?.raf) cancelAnimationFrame(resizing.raf); setResizing(null); }
    if (resizing) { window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp); }
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [resizing, graph, onChange, zoom]);

  // Pan / zoom
  const [panning, setPanning] = useState<null | { sx: number; sy: number; px: number; py: number }>(null);
  const onWheel: React.WheelEventHandler = (e) => {
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const next = clampZoom(zoom * factor);
    if (next !== zoom) onViewChange({ zoom: next });
  };

  // Connect (OUT → IN)
  const [pending, setPending] = useState<null | { from: { deviceId: string; portName: string } }>(null);
  const [cursorWorld, setCursorWorld] = useState<null | { x: number; y: number }>(null);

  // client → world coords helper
  const clientToWorld = (clientX: number, clientY: number) => {
    if (!wrapRef.current) return { x: 0, y: 0 };
    const rect = wrapRef.current.getBoundingClientRect();
    return { x: (clientX - rect.left) / zoom - pan.x, y: (clientY - rect.top) / zoom - pan.y };
  };

  function handlePortClick(e: React.MouseEvent, d: Device, p: Port) {
    if (!pending) {
      // start connect mode and show dashed cable immediately
      setCursorWorld(clientToWorld(e.clientX, e.clientY));
      setPending({ from: { deviceId: d.id, portName: p.name } });
      return;
    }
    if (pending.from.deviceId === d.id && pending.from.portName === p.name) {
      setPending(null);
      setCursorWorld(null);
      return;
    }

    const aDev = graph.devices.find((x) => x.id === pending.from.deviceId)!;
    const aPort = aDev.ports.find((pp) => pp.name === pending.from.portName)!;
    const bDev = d; const bPort = p;

    let fromEnd: { deviceId: string; portName: string };
    let toEnd: { deviceId: string; portName: string };

    if (aPort.direction === "OUT" && bPort.direction === "IN") {
      fromEnd = { deviceId: aDev.id, portName: aPort.name };
      toEnd = { deviceId: bDev.id, portName: bPort.name };
    } else if (aPort.direction === "IN" && bPort.direction === "OUT") {
      fromEnd = { deviceId: bDev.id, portName: bPort.name };
      toEnd = { deviceId: aDev.id, portName: aPort.name };
    } else {
      // restart from the clicked port on the same side
      setPending({ from: { deviceId: d.id, portName: p.name } });
      setCursorWorld(clientToWorld(e.clientX, e.clientY));
      return;
    }

    onChange(addConnection(graph, fromEnd, toEnd));
    setPending(null);
    setCursorWorld(null);
  }

  // BODY ports SVG
  function DevicePortsSVG({ d }: { d: Device }) {
    const w = d.w ?? BOX_W;
    const h = d.h ?? BOX_H;
    const INs = (d.ports ?? []).filter((p) => p.direction === "IN");
    const OUTs = (d.ports ?? []).filter((p) => p.direction === "OUT");
    const armed = pending?.from?.deviceId === d.id ? pending.from.portName : null;

    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="absolute inset-0">
        {INs.map((p, idx) => {
          const cy = pinYLocalBody(h, INs.length, idx);
          const cx = PIN_INSET;
          const selected = armed === p.name;
          return (
            <g key={p.id} className="cursor-crosshair" onMouseDown={(e) => e.stopPropagation()}
               onClick={(e) => { e.stopPropagation(); handlePortClick(e, d, p); }}>
              <circle cx={cx} cy={cy} r={selected ? 6 : 5} fill="#10b981" stroke={selected ? "#34d399" : "white"} strokeWidth={selected ? 3 : 2} />
              <text x={cx + 9} y={cy + 0.5} fontSize={PORT_FONT} fill="#e2e8f0" dominantBaseline="middle">{p.name}</text>
            </g>
          );
        })}
        {OUTs.map((p, idx) => {
          const cy = pinYLocalBody(h, OUTs.length, idx);
          const cx = w - PIN_INSET;
          const selected = armed === p.name;
          return (
            <g key={p.id} className="cursor-crosshair" onMouseDown={(e) => e.stopPropagation()}
               onClick={(e) => { e.stopPropagation(); handlePortClick(e, d, p); }}>
              <circle cx={cx} cy={cy} r={selected ? 6 : 5} fill="#38bdf8" stroke={selected ? "#60a5fa" : "white"} strokeWidth={selected ? 3 : 2} />
              <text x={cx - 9} y={cy + 0.5} fontSize={PORT_FONT} fill="#e2e8f0" dominantBaseline="middle" textAnchor="end">{p.name}</text>
            </g>
          );
        })}
      </svg>
    );
  }

  // big viewBox so curves aren’t clipped as you pan/zoom
  const VB_MARGIN = 20000;
  const vb = `${-VB_MARGIN} ${-VB_MARGIN} ${canvasSize.w + VB_MARGIN * 2} ${canvasSize.h + VB_MARGIN * 2}`;

  return (
    <div className="relative w-full h-full select-none" onWheel={onWheel}>
      {showGrid && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(100,116,139,0.15) 1px, transparent 1px), linear-gradient(to bottom, rgba(100,116,139,0.15) 1px, transparent 1px)",
            backgroundSize: `${gridCell}px ${gridCell}px`,
            backgroundPosition: `${gridPosX}px ${gridPosY}px`,
          }}
        />
      )}

      {/* World wrapper */}
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
          if (pending) setCursorWorld(clientToWorld(e.clientX, e.clientY));
          if (!panning) return;
          const dx = (e.clientX - panning.sx) / zoom;
          const dy = (e.clientY - panning.sy) / zoom;
          onViewChange({ pan: { x: panning.px + dx, y: panning.py + dy } });
        }}
        onMouseUp={() => setPanning(null)}
        onContextMenu={(e) => e.preventDefault()}
        style={{ transform: `translate(${pan.x * zoom}px, ${pan.y * zoom}px) scale(${zoom})`, transformOrigin: "0 0" }}
      >
        {/* Connection overlay */}
        <svg
          className="absolute"
          style={{ left: 0, top: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}
          viewBox={vb}
        >
          {graph.connections.map((c) => {
            const Adev = deviceMap.get(c.from.deviceId);
            const Bdev = deviceMap.get(c.to.deviceId);
            if (!Adev || !Bdev) return null;
            const A = portWorldPos(Adev, c.from.portName, "OUT");
            const B = portWorldPos(Bdev, c.to.portName, "IN");
            const midX = (A.x + B.x) / 2;
            return (
              <path
                key={c.id}
                d={`M ${A.x},${A.y} C ${midX},${A.y} ${midX},${B.y} ${B.x},${B.y}`}
                fill="none"
                stroke="rgba(56,189,248,0.95)"
                strokeWidth={2}
              />
            );
          })}
          {pending && cursorWorld && (() => {
            const dev = deviceMap.get(pending.from.deviceId);
            if (!dev) return null;
            const firstPort = dev.ports.find((pp) => pp.name === pending.from.portName);
            if (!firstPort) return null;
            const A = portWorldPos(dev, pending.from.portName, firstPort.direction as "IN" | "OUT");
            const B = cursorWorld;
            const midX = (A.x + B.x) / 2;
            return (
              <path
                d={`M ${A.x},${A.y} C ${midX},${A.y} ${midX},${B.y} ${B.x},${B.y}`}
                fill="none"
                stroke="rgba(148,163,184,0.9)"
                strokeDasharray="6 6"
                strokeWidth={2}
              />
            );
          })()}
        </svg>

        {/* DEVICES */}
        {devices.map((d) => {
          const w = d.w ?? BOX_W;
          const h = d.h ?? BOX_H;
          const selected = selectedIds.has(d.id);
          const bodyColor = d.color || "#334155";
          const x = d.x ?? 0;
          const y = d.y ?? 0;

          return (
            <React.Fragment key={d.id}>
              {/* header (separate object) */}
              <div
                className="absolute rounded-t-xl border border-white/10"
                style={{
                  left: x, top: y - HEADER_H, width: w, height: HEADER_H,
                  background: "rgba(0,0,0,0.22)", borderBottom: "none",
                  boxShadow: selected ? "0 0 0 2px rgba(59,130,246,0.8)" : undefined,
                }}
              >
                <div className="h-full px-2 flex flex-col justify-center">
                  <div className="text-[12px] flex items-center justify-between leading-none">
                    <div className="font-medium truncate">{d.customName ?? d.id}</div>
                    <div className="opacity-70 ml-2 truncate">{d.type}</div>
                  </div>
                  <div className="text-[10px] opacity-85 mt-1 truncate leading-none">
                    {(d as any).manufacturer || ""}{((d as any).manufacturer && (d as any).model) ? " • " : ""}{(d as any).model || ""}
                  </div>
                </div>
              </div>

              {/* body */}
              <div
                className="absolute rounded-b-xl shadow-lg"
                style={{
                  left: x, top: y, width: w, height: h, background: bodyColor,
                  border: "1px solid rgba(148,163,184,0.35)", borderTop: "none",
                  boxShadow: selected
                    ? "0 0 0 2px rgba(59,130,246,0.9), 0 0 18px rgba(59,130,246,0.5)"
                    : "0 4px 12px rgba(0,0,0,0.25)",
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
                    orig: Object.fromEntries(
                      ids.map((id) => {
                        const dev = devices.find((x) => x.id === id)!;
                        return [id, { x: dev.x ?? 0, y: dev.y ?? 0 }];
                      })
                    ),
                  });
                }}
              >
                <div className="relative w-full h-full">
                  <DevicePortsSVG d={d} />
                </div>

                {/* resize handle */}
                <div
                  className="absolute w-3 h-3 right-0 bottom-0 translate-x-1 translate-y-1 rounded-sm border border-white/50 bg-white/60 cursor-nwse-resize"
                  onMouseDown={(e) => { e.stopPropagation(); setResizing({ id: d.id, sx: e.clientX, sy: e.clientY, w, h }); }}
                  title="Resize"
                />
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* diagnostics */}
      <div className="absolute bottom-2 right-3 text-[11px] text-slate-200 bg-black/40 px-2 py-1 rounded border border-white/10">
        {devices.length} devices • {graph.connections.length} connections {snapEnabled ? "• snap: ON" : "• snap: OFF"}
      </div>
      <div className="absolute bottom-2 left-3 text-[11px] text-slate-400 bg-black/30 px-2 py-1 rounded">
        Select/Move: Drag • Pan: Right-drag / Pan tool • Wheel: Zoom • Connect: OUT → IN
      </div>
    </div>
  );
}
