import React, { useEffect, useMemo, useRef, useState } from "react";
import type { GraphState } from "../lib/editor";
import { clampZoom } from "../lib/editor";

type Device = GraphState["devices"][number];

type Props = {
  graph?: GraphState | null;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onChange?: (next: GraphState) => void;
  showGrid?: boolean;

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
      if (typeof d.x === "number" && typeof d.y === "number")
        return { ...d, w: d.w ?? BOX_W, h: d.h ?? BOX_H };
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = 40 + col * (BOX_W + GAP_X);
      const y = 40 + row * (BOX_H + GAP_Y);
      return { ...d, x, y, w: d.w ?? BOX_W, h: d.h ?? BOX_H };
    });

    // make "world" comfortably large so grid never looks clipped
    const minW = 3000;
    const minH = 2000;
    const contentW =
      (Math.min(out.length - 1, COLS - 1) + 1) * (BOX_W + GAP_X) + 80 || 800;
    const rows = Math.ceil(out.length / COLS);
    const contentH = rows * (BOX_H + GAP_Y) + 120 || 600;

    return {
      positioned: out,
      width: Math.max(contentW, minW),
      height: Math.max(contentH, minH),
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
    return { cx: (d.x ?? 0) + (d.w ?? BOX_W) / 2, cy: (d.y ?? 0) + (d.h ?? BOX_H) / 2 };
  }

  // global mouse handlers while dragging device
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!drag || !graph || !onChange) return;
      const dx = (e.clientX - drag.startX) / zoom;
      const dy = (e.clientY - drag.startY) / zoom;

      const nextDevices = graph.devices.map((d) =>
        d.id === drag.id
          ? { ...d, x: Math.max(0, drag.origX + dx), y: Math.max(0, drag.origY + dy) }
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
  const [panning, setPanning] = useState<{ sx: number; sy: number; px: number; py: number } | null>(null);

  const onWheel: React.WheelEventHandler = (e) => {
    if (!onViewChange) return;
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const nextZoom = clampZoom(zoom * factor);
    if (nextZoom !== zoom) onViewChange({ zoom: nextZoom });
  };

  const onMouseDownWorld: React.MouseEventHandler<HTMLDivElement> = (e) => {
    // Right button drag to pan
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

  const onContextMenu: React.MouseEventHandler = (e) => e.preventDefault();

  // click background to clear selection
  const onBackgroundClick = (e: React.MouseEvent) => {
    if (e.target === wrapRef.current) onSelect?.(null);
  };

  // --- helpers to render port pins on left/right ---
  const getPortsBySide = (d: Device) => {
    const ports = d.ports ?? [];
    const left = ports.filter((p: any) => p.direction === "IN");
    const right = ports.filter((p: any) => p.direction === "OUT");
    return { left, right };
  };

  return (
    <div
      ref={wrapRef}
      onClick={onBackgroundClick}
      onWheel={onWheel}
      onContextMenu={onContextMenu}
      className="m-4 h-[calc(100%-2rem)] rounded-2xl border border-slate-700 bg-slate-900/40 relative overflow-hidden"
    >
      {/* world space (panned & zoomed) */}
      <div
        className="w-full h-full relative"
        onMouseDown={onMouseDownWorld}
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "0 0",
          // Infinite-looking grid by CSS gradients; it scales with zoom because it's on the world
          backgroundImage: showGrid
            ? `
                linear-gradient(to right, rgba(148,163,184,0.12) 1px, transparent 1px),
                linear-gradient(to bottom, rgba(148,163,184,0.12) 1px, transparent 1px)
              `
            : "none",
          backgroundSize: showGrid ? "24px 24px, 24px 24px" : undefined,
          backgroundPosition: "0 0, 0 0",
        }}
      >
        <div style={{ width, height, position: "relative" }}>
          {/* connections */}
          <svg width={width} height={height} className="absolute inset-0 pointer-events-none">
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
            const w = d.w ?? BOX_W;
            const h = d.h ?? BOX_H;
            const { left, right } = getPortsBySide(d);

            return (
              <div
                key={d.id}
                style={{ left: d.x, top: d.y, width: w, height: h, cursor: "grab" }}
                className={`absolute rounded-xl border shadow-sm transition-all
                  ${isSel ? "border-blue-400 ring-2 ring-blue-400/40" : "border-slate-600"}
                  bg-slate-800/80 hover:shadow-md select-none`}
                onMouseDown={(e) => {
                  if (e.button !== 0) return;
                  e.stopPropagation();
                  onSelect?.(d.id);
                  setDrag({ id: d.id, startX: e.clientX, startY: e.clientY, origX: d.x ?? 0, origY: d.y ?? 0 });
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onSelect?.(d.id);
                }}
              >
                {/* Header */}
                <div className="px-3 pt-2 text-sm font-medium text-slate-100 truncate">
                  {d.customName ?? d.id}
                </div>
                <div className="px-3 text-[11px] text-slate-400 flex gap-2">
                  <span>{d.type ?? "device"}</span>
                  {((d as any).manufacturer || (d as any).model) && (
                    <span className="text-slate-500">
                      • {(d as any).manufacturer ?? ""} {(d as any).model ?? ""}
                    </span>
                  )}
                </div>

                {/* Port rails */}
                {/* Left (IN) */}
                <div className="absolute left-0 top-0 bottom-0 w-3">
                  {left.map((p: any, idx: number) => {
                    const y = ((idx + 1) * h) / (left.length + 1);
                    return (
                      <div key={p.name} className="absolute -left-[6px]" style={{ top: y - 4 }}>
                        <div className="w-2 h-2 rounded-full bg-emerald-400 border border-emerald-300" title={`${p.name} (${p.type})`} />
                      </div>
                    );
                  })}
                </div>
                {/* Right (OUT) */}
                <div className="absolute right-0 top-0 bottom-0 w-3">
                  {right.map((p: any, idx: number) => {
                    const y = ((idx + 1) * h) / (right.length + 1);
                    return (
                      <div key={p.name} className="absolute -right-[6px]" style={{ top: y - 4 }}>
                        <div className="w-2 h-2 rounded-full bg-sky-400 border border-sky-300" title={`${p.name} (${p.type})`} />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* small hint overlay */}
      <div className="absolute bottom-2 left-3 text-[11px] text-slate-400 bg-black/30 px-2 py-1 rounded">
        Wheel = Zoom • Right-drag = Pan • Click = Select • Drag = Move • Ports: IN=left, OUT=right
      </div>
    </div>
  );
}
