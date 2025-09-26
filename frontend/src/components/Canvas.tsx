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
const HEADER_H = 36;
const PIN_INSET = 7; // inside the box
const PORT_FONT = 10;

// -- Shared geometry for inline device SVG and global connections overlay
function portWorldPos(device: Device, portName: string, dir: "IN" | "OUT") {
  const w = device.w ?? BOX_W;
  const h = device.h ?? BOX_H;
  const INs = (device.ports ?? []).filter((p) => p.direction === "IN");
  const OUTs = (device.ports ?? []).filter((p) => p.direction === "OUT");

  // padding so first/last pins never spill
  const TOP_PAD = 10;
  const BOT_PAD = 18;
  const yArea = Math.max(0, h - HEADER_H - TOP_PAD - BOT_PAD);
  const yFor = (idx: number, total: number) => {
    if (total <= 1) return (device.y ?? 0) + HEADER_H + TOP_PAD + yArea / 2;
    const step = yArea / (total - 1);
    return (device.y ?? 0) + HEADER_H + TOP_PAD + idx * step;
  };

  if (dir === "IN") {
    const idx = INs.findIndex((p) => p.name === portName);
    return { x: (device.x ?? 0) + PIN_INSET, y: yFor(idx, INs.length) };
  } else {
    const idx = OUTs.findIndex((p) => p.name === portName);
    return { x: (device.x ?? 0) + w - PIN_INSET, y: yFor(idx, OUTs.length) };
  }
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
  const deviceMap = useMemo(
    () => new Map(devices.map((d) => [d.id, d] as const)),
    [devices]
  );

  const wrapRef = useRef<HTMLDivElement | null>(null);

  // GRID (view space)
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
        const next: GraphState = {
          ...graph,
          devices: graph.devices.map((d) => {
            if (!drag.ids.includes(d.id)) return d;
            const start = drag.orig[d.id];
            const moved = moveDevice(
              { ...d, x: start.x, y: start.y },
              dx,
              dy,
              { snapToGrid: snapEnabled, gridSize }
            );
            return moved;
          }),
        };
        onChange(next);
      });
      setDrag((r) => (r ? { ...r, raf } : r));
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

  // RESIZE (declare state before effect that uses it)
  const [resizing, setResizing] = useState<null | {
    id: string;
    sx: number;
    sy: number;
    w: number;
    h: number;
    raf?: number;
  }>(null);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!resizing) return;
      const dx = (e.clientX - resizing.sx) / zoom;
      const dy = (e.clientY - resizing.sy) / zoom;

      // per-device minimums so ports stay inside & labels don’t overlap
      const dev = graph.devices.find((d) => d.id === resizing.id);
      const INs = (dev?.ports ?? []).filter((p) => p.direction === "IN");
      const OUTs = (dev?.ports ?? []).filter((p) => p.direction === "OUT");
      const rows = Math.max(INs.length, OUTs.length);

      const CHAR_W = Math.ceil(PORT_FONT * 0.6);
      const leftLen = INs.reduce(
        (m, p) => Math.max(m, (p.name || "").length),
        0
      );
      const rightLen = OUTs.reduce(
        (m, p) => Math.max(m, (p.name || "").length),
        0
      );
      const MIDDLE_GAP = 24;
      const minW = Math.max(
        120,
        2 * (PIN_INSET + 9) + leftLen * CHAR_W + rightLen * CHAR_W + MIDDLE_GAP
      );

      const TOP_PAD = 10;
      const BOT_PAD = 18;
      const ROW_SP = 24;
      const minH = Math.max(
        80,
        HEADER_H +
          TOP_PAD +
          BOT_PAD +
          (rows > 1 ? (rows - 1) * ROW_SP : ROW_SP)
      );

      const nw = Math.max(minW, resizing.w + dx);
      const nh = Math.max(minH, resizing.h + dy);

      cancelAnimationFrame(resizing.raf ?? 0);
      const raf = requestAnimationFrame(() => {
        onChange({
          ...graph,
          devices: graph.devices.map((d) =>
            d.id === resizing.id ? { ...d, w: nw, h: nh } : d
          ),
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

  // PAN / ZOOM
  const [panning, setPanning] = useState<{
    sx: number;
    sy: number;
    px: number;
    py: number;
  } | null>(null);

  const onWheel: React.WheelEventHandler = (e) => {
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const next = clampZoom(zoom * factor);
    if (next !== zoom) onViewChange({ zoom: next });
  };

  // CONNECT (click OUT → click IN)
  const [pending, setPending] =
    useState<null | { from: { deviceId: string; portName: string } }>(null);

  // ghost wire follows the mouse while a port is armed
  const [cursorWorld, setCursorWorld] =
    useState<{ x: number; y: number } | null>(null);

  function handlePortClick(d: Device, p: Port) {
    if (!pending) {
      setPending({ from: { deviceId: d.id, portName: p.name } });
      setCursorWorld(null);
      return;
    }
    if (pending.from.deviceId === d.id && pending.from.portName === p.name) {
      setPending(null);
      setCursorWorld(null);
      return;
    }

    const firstDev = graph.devices.find(
      (x) => x.id === pending.from.deviceId
    )!;
    const firstPort = firstDev.ports.find(
      (pp) => pp.name === pending.from.portName
    )!;

    const secondDev = d;
    const secondPort = p;

    let fromEnd: { deviceId: string; portName: string };
    let toEnd: { deviceId: string; portName: string };

    if (firstPort.direction === "OUT" && secondPort.direction === "IN") {
      fromEnd = { deviceId: firstDev.id, portName: firstPort.name };
      toEnd = { deviceId: secondDev.id, portName: secondPort.name };
    } else if (firstPort.direction === "IN" && secondPort.direction === "OUT") {
      fromEnd = { deviceId: secondDev.id, portName: secondPort.name };
      toEnd = { deviceId: firstDev.id, portName: firstPort.name };
    } else {
      setPending({ from: { deviceId: d.id, portName: p.name } });
      return;
    }

    const next = addConnection(graph, fromEnd, toEnd);
    onChange(next);
    setPending(null);
    setCursorWorld(null);
  }

  // helper: render pin + label in device-local SVG
  function DevicePortsSVG({ d }: { d: Device }) {
    const w = d.w ?? BOX_W;
    const h = d.h ?? BOX_H;
    const INs = (d.ports ?? []).filter((p) => p.direction === "IN");
    const OUTs = (d.ports ?? []).filter((p) => p.direction === "OUT");

    const TOP_PAD = 10;
    const BOT_PAD = 18;
    const yArea = Math.max(0, h - HEADER_H - TOP_PAD - BOT_PAD);
    const yFor = (idx: number, total: number) => {
      if (total <= 1) return HEADER_H + TOP_PAD + yArea / 2;
      const step = yArea / (total - 1);
      return HEADER_H + TOP_PAD + idx * step;
    };

    const armed =
      pending && pending.from && pending.from.deviceId === d.id
        ? pending.from.portName
        : null;

    return (
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        className="absolute inset-0"
      >
        {/* INs (left) */}
        {INs.map((p, idx) => {
          const cy = yFor(idx, INs.length);
          const cx = PIN_INSET;
          const selected = armed === p.name;
          return (
            <g
              key={p.id}
              className="cursor-crosshair"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                handlePortClick(d, p);
              }}
            >
              <circle
                cx={cx}
                cy={cy}
                r={selected ? 6 : 5}
                fill="#10b981"
                stroke={selected ? "#34d399" : "white"}
                strokeWidth={selected ? 3 : 2}
                style={
                  selected
                    ? {
                        filter:
                          "drop-shadow(0 0 4px rgba(52,211,153,0.9))",
                      }
                    : {}
                }
              />
              <text
                x={cx + 9}
                y={cy + 0.5}
                fontSize={PORT_FONT}
                fill="#e2e8f0"
                dominantBaseline="middle"
              >
                {p.name}
              </text>
            </g>
          );
        })}

        {/* OUTs (right) */}
        {OUTs.map((p, idx) => {
          const cy = yFor(idx, OUTs.length);
          const cx = w - PIN_INSET;
          const selected = armed === p.name;
          return (
            <g
              key={p.id}
              className="cursor-crosshair"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                handlePortClick(d, p);
              }}
            >
              <circle
                cx={cx}
                cy={cy}
                r={selected ? 6 : 5}
                fill="#38bdf8"
                stroke={selected ? "#60a5fa" : "white"}
                strokeWidth={selected ? 3 : 2}
                style={
                  selected
                    ? { filter: "drop-shadow(0 0 4px rgba(59,130,246,0.9))" }
                    : {}
                }
              />
              <text
                x={cx - 9}
                y={cy + 0.5}
                fontSize={PORT_FONT}
                fill="#e2e8f0"
                dominantBaseline="middle"
                textAnchor="end"
              >
                {p.name}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }

  return (
    <div className="relative w-full h-full select-none" onWheel={onWheel}>
      {/* GRID */}
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
          // ghost wire position
          if (pending && wrapRef.current) {
            const rect = wrapRef.current.getBoundingClientRect();
            const worldX = (e.clientX - rect.left) / zoom - pan.x;
            const worldY = (e.clientY - rect.top) / zoom - pan.y;
            setCursorWorld({ x: worldX, y: worldY });
          }

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
        {/* connections overlay */}
        <svg
          width="100%"
          height="100%"
          className="absolute inset-0 pointer-events-none"
        >
          {graph.connections.map((c) => {
            const Adev = deviceMap.get(c.from.deviceId)!;
            const Bdev = deviceMap.get(c.to.deviceId)!;
            if (!Adev || !Bdev) return null;
            const A = portWorldPos(Adev, c.from.portName, "OUT");
            const B = portWorldPos(Bdev, c.to.portName, "IN");
            const midX = (A.x + B.x) / 2;
            const d = `M ${A.x},${A.y} C ${midX},${A.y} ${midX},${B.y} ${B.x},${B.y}`;
            return (
              <path
                key={c.id}
                d={d}
                fill="none"
                stroke="rgba(56,189,248,0.95)"
                strokeWidth={2}
              />
            );
          })}

          {/* ghost wire while a port is armed */}
          {pending &&
            cursorWorld &&
            (() => {
              const dev = deviceMap.get(pending.from.deviceId);
              if (!dev) return null;
              const firstPort = dev.ports.find(
                (pp) => pp.name === pending.from.portName
              );
              if (!firstPort) return null;
              const A = portWorldPos(
                dev,
                pending.from.portName,
                firstPort.direction as "IN" | "OUT"
              );
              const B = cursorWorld;
              const midX = (A.x + B.x) / 2;
              const d = `M ${A.x},${A.y} C ${midX},${A.y} ${midX},${B.y} ${B.x},${B.y}`;
              return (
                <path
                  d={d}
                  fill="none"
                  stroke="rgba(148,163,184,0.9)"
                  strokeDasharray="6 6"
                  strokeWidth={2}
                />
              );
            })()}
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
                boxShadow: selected
                  ? "0 0 0 2px rgba(59,130,246,0.9), 0 0 18px rgba(59,130,246,0.5)"
                  : "0 4px 12px rgba(0,0,0,0.25)",
                transition: "box-shadow 120ms ease",
              }}
              onMouseDown={(e) => {
                if (e.button !== 0) return;
                const ids =
                  e.shiftKey || e.metaKey || e.ctrlKey
                    ? Array.from(new Set([...selectedIds, d.id]))
                    : [d.id];

                if (!(e.shiftKey || e.metaKey || e.ctrlKey))
                  onToggleSelect(d.id, false);
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
              {/* header */}
              <div
                className="px-2 py-1.5 border-b border-white/10"
                style={{ background: "rgba(0,0,0,0.15)", height: HEADER_H }}
              >
                <div className="text-[12px] flex items-center justify-between">
                  <div className="font-medium truncate">
                    {d.customName ?? d.id}
                  </div>
                  <div className="opacity-70 ml-2 truncate">{d.type}</div>
                </div>
                <div className="text-[10px] opacity-85 mt-0.5 truncate">
                  {(d as any).manufacturer || ""}
                  {((d as any).manufacturer && (d as any).model) ? " • " : ""}
                  {(d as any).model || ""}
                </div>
              </div>

              {/* ports */}
              <div className="relative w-full h-full">
                <DevicePortsSVG d={d} />
              </div>

              {/* resize handle */}
              <div
                className="absolute w-3 h-3 right-0 bottom-0 translate-x-1 translate-y-1 rounded-sm border border-white/50 bg-white/60 cursor-nwse-resize"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setResizing({
                    id: d.id,
                    sx: e.clientX,
                    sy: e.clientY,
                    w: w,
                    h: h,
                  });
                }}
                title="Resize"
              />
            </div>
          );
        })}
      </div>

      {/* diagnostics */}
      <div className="absolute bottom-2 right-3 text-[11px] text-slate-200 bg-black/40 px-2 py-1 rounded border border-white/10">
        {devices.length} devices • {graph.connections.length} connections{" "}
        {snapEnabled ? "• snap: ON" : "• snap: OFF"}
      </div>

      {/* hint */}
      <div className="absolute bottom-2 left-3 text-[11px] text-slate-400 bg-black/30 px-2 py-1 rounded">
        Select/Move: Drag • Pan: Right-drag / Pan tool • Wheel: Zoom • Connect:
        OUT port → IN port
      </div>
    </div>
  );
}
