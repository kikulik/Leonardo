import React, { useEffect, useMemo, useRef, useState } from "react";
import type { GraphState } from "../lib/editor";
import { clampZoom } from "../lib/editor";

type Device = GraphState["devices"][number];

type ConnectionEnd = { deviceId: string; portName?: string };

type Props = {
  graph?: GraphState | null;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onChange?: (next: GraphState) => void; // fired when positions change via drag
  showGrid?: boolean;

  // view controls
  zoom?: number; // default 1
  pan?: { x: number; y: number }; // default {0,0}
  onViewChange?: (v: { zoom?: number; pan?: { x: number; y: number } }) => void;
};

const BOX_W = 160;
const BOX_H = 80;
const GAP_X = 40;
const GAP_Y = 40;
const COLS = 4;

export function Canvas({
  graph,
  selectedId,
  onSelect,
  onChange,
  showGrid = true,
  zoom = 1,
  pan = { x: 0, y: 0 },
  onViewChange,
}: Props) {
  const devices = graph?.devices ?? [];
  const deviceMap = useMemo(
    () => new Map(devices.map((d) => [d.id, d])),
    [devices]
  );

  // compute positions (auto if no x/y)
  const { positioned, width, height } = useMemo(() => {
    const out = devices.map((d, i) => {
      if (typeof d.x === "number" && typeof d.y === "number") return d;
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = 40 + col * (BOX_W + GAP_X);
      const y = 40 + row * (BOX_H + GAP_Y);
      return { ...d, x, y, w: d.w ?? BOX_W, h: d.h ?? BOX_H };
    });

    const w =
      (Math.min(out.length - 1, COLS - 1) + 1) * (BOX_W + GAP_X) + 80 || 800;
    const rows = Math.ceil(out.length / COLS);
    const h = rows * (BOX_H + GAP_Y) + 120 || 600;
    return {
      positioned: out,
      width: Math.max(w, 800),
      height: Math.max(h, 600),
    };
  }, [devices]);

  // ---- dragging device state ----
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<{
    id: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  function centerOf(d: Device) {
    return { cx: (d.x ?? 0) + BOX_W / 2, cy: (d.y ?? 0) + BOX_H / 2 };
  }

  // global mouse handlers while dragging device
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!drag || !graph || !onChange) return;
      // account for zoom when converting screen delta to canvas units
      const dx = (e.clientX - drag.startX) / zoom;
      const dy = (e.clientY - drag.startY) / zoom;

      const nextDevices = graph.devices.map((d) =>
        d.id === drag.id
          ? {
              ...d,
              x: Math.max(0, drag.origX + dx),
              y: Math.max(0, drag.origY + dy),
            }
          : d
      );
      onChange({ ...graph, devices: nextDevices });
    }
    function onUp() {
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
  }, [drag, graph, onChange, zoom]);

  // ---- pan/zoom handlers ----
  const viewPanRef = useRef(pan);
  useEffect(() => {
    viewPanRef.current = pan;
  }, [pan]);

  const onWheel: React.WheelEventHandler = (e) => {
    if (!onViewChange) return;
    // zoom around cursor
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const nextZoom = clampZoom(zoom * factor);
    // Keep it simple: no focal-point math; adjust pan a bit for feel
    if (nextZoom !== zoom) {
      onViewChange({ zoom: nextZoom });
    }
  };

  // Right mouse drag to pan
  const [panning, setPanning] = useState<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const onMouseDown: React.MouseEventHandler<HTMLDivElement> = (e) => {
    // Right button -> pan
    if (e.button === 2) {
      e.preventDefault();
      setPanning({ sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y });
    }
  };
  useEffect(() => {
    function move(e: MouseEvent) {
      if (!panning || !onViewChange) return;
      const dx = e.clientX - panning.sx;
      const dy = e.clientY - panning.sy;
      onViewChange({ pan: { x: panning.px + dx, y: panning.py + dy } });
    }
    function up() {
      setPanning(null);
    }
    if (panning) {
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    }
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [panning, onViewChange]);

  // context menu disable (so right-drag works cleanly)
  const onContextMenu: React.MouseEventHandler = (e) => {
    e.preventDefault();
  };

  // click background to clear selection
  const onBackgroundClick = (e: React.MouseEvent) => {
    if (e.target === wrapRef.current) onSelect?.(null);
  };

  return (
    <div
      ref={wrapRef}
      onClick={onBackgroundClick}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onContextMenu={onContextMenu}
      className="m-4 h-[calc(100%-2rem)] rounded-2xl border border-slate-700 bg-slate-900/40 relative overflow-hidden"
    >
      {/* world space (panned & zoomed) */}
      <div
        className="w-full h-full relative"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "0 0",
        }}
      >
        <div style={{ width, height, position: "relative" }}>
          {/* grid */}
          {showGrid && (
            <>
              <svg width={width} height={height} className="absolute inset-0">
                <defs>
                  <pattern
                    id="minor-grid"
                    width="24"
                    height="24"
                    patternUnits="userSpaceOnUse"
                  >
                    <path
                      d="M 24 0 L 0 0 0 24"
                      fill="none"
                      stroke="rgba(148,163,184,0.12)"
                      strokeWidth="1"
                    />
                  </pattern>
                </defs>
              </svg>
              <div
                className="absolute inset-0"
                style={{ background: "url(#)" }}
              >
                <svg width={width} height={height} className="absolute inset-0">
                  <rect width="100%" height="100%" fill="url(#minor-grid)" />
                </svg>
              </div>
            </>
          )}

          {/* connections */}
          <svg
            width={width}
            height={height}
            className="absolute inset-0 pointer-events-none"
          >
            {(graph?.connections ?? []).map((c, i) => {
              const a = deviceMap.get(c.from.deviceId);
              const b = deviceMap.get(c.to.deviceId);
              if (!a || !b) return null;
              const A = centerOf(a);
              const B = centerOf(b);
              return (
                <line
                  key={i}
                  x1={A.cx}
                  y1={A.cy}
                  x2={B.cx}
                  y2={B.cy}
                  stroke="rgba(96,165,250,0.7)"
                  strokeWidth={2}
                />
              );
            })}
          </svg>

          {/* devices */}
          {positioned.map((d) => {
            const isSel = d.id === selectedId;
            return (
              <div
                key={d.id}
                style={{
                  left: d.x,
                  top: d.y,
                  width: d.w ?? BOX_W,
                  height: d.h ?? BOX_H,
                  cursor: "grab",
                }}
                className={`absolute rounded-xl border shadow-sm transition-all
                ${
                  isSel
                    ? "border-blue-400 ring-2 ring-blue-400/40"
                    : "border-slate-600"
                }
                bg-slate-800/80 hover:shadow-md select-none`}
                onMouseDown={(e) => {
                  if (e.button !== 0) return; // left only for device drag
                  e.stopPropagation();
                  onSelect?.(d.id);
                  setDrag({
                    id: d.id,
                    startX: e.clientX,
                    startY: e.clientY,
                    origX: d.x ?? 0,
                    origY: d.y ?? 0,
                  });
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onSelect?.(d.id);
                  // future: open properties editor
                }}
              >
                <div className="px-3 pt-2 text-sm font-medium text-slate-100">
                  {d.customName ?? d.id}
                </div>
                <div className="px-3 text-xs text-slate-400">
                  {d.type ?? "device"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* small hint overlay */}
      <div className="absolute bottom-2 left-3 text-[11px] text-slate-400 bg-black/30 px-2 py-1 rounded">
        Wheel = Zoom • Right-drag = Pan • Click = Select • Drag = Move
      </div>
    </div>
  );
}
