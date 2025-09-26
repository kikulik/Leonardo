import React, { useEffect, useMemo, useRef, useState } from "react";
import type { GraphState } from "../lib/editor";
import { clampZoom, nextConnectionIdFor } from "../lib/editor";

type Device = GraphState["devices"][number];

type Mode = "select" | "pan" | "connect";

type Props = {
  graph?: GraphState | null;
  selectedIds?: Set<string>;
  mode?: Mode;
  onToggleSelect?: (id: string, additive: boolean) => void;
  onClearSelection?: () => void;
  onChange?: (next: GraphState) => void;

  showGrid?: boolean;
  zoom?: number;
  pan?: { x: number; y: number };
  onViewChange?: (v: { zoom?: number; pan?: { x: number; y: number } }) => void;
};

const BOX_W = 160;
const BOX_H = 80;
const GAP_X = 40;
const GAP_Y = 40;
const COLS = 4;

export function Canvas({
  graph,
  selectedIds,
  mode = "select",
  onToggleSelect,
  onClearSelection,
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

  const wrapRef = useRef<HTMLDivElement | null>(null);

  // compute positions (auto if missing) + massive world size so grid is always visible
  const { positioned, worldW, worldH } = useMemo(() => {
    const out = devices.map((d, i) => {
      if (typeof d.x === "number" && typeof d.y === "number")
        return { ...d, w: d.w ?? BOX_W, h: d.h ?? BOX_H };
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = 40 + col * (BOX_W + GAP_X);
      const y = 40 + row * (BOX_H + GAP_Y);
      return { ...d, x, y, w: d.w ?? BOX_W, h: d.h ?? BOX_H };
    });

    // “infinite” world
    return {
      positioned: out,
      worldW: 100000,
      worldH: 100000,
    };
  }, [devices]);

  const centerOf = (d: Device) => ({
    cx: (d.x ?? 0) + (d.w ?? BOX_W) / 2,
    cy: (d.y ?? 0) + (d.h ?? BOX_H) / 2,
  });

  // ---- drag device(s) ----
  const [drag, setDrag] = useState<{
    ids: string[];
    startX: number;
    startY: number;
    orig: { [id: string]: { x: number; y: number } };
  } | null>(null);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!drag || !graph || !onChange) return;
      const dx = (e.clientX - drag.startX) / zoom;
      const dy = (e.clientY - drag.startY) / zoom;

      const nextDevices = graph.devices.map((d) =>
        drag.ids.includes(d.id)
          ? { ...d, x: Math.max(0, drag.orig[d.id].x + dx), y: Math.max(0, drag.orig[d.id].y + dy) }
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

  // ---- pan/zoom ----
  const [panning, setPanning] = useState<{ sx: number; sy: number; px: number; py: number } | null>(null);

  const onWheel: React.WheelEventHandler = (e) => {
    if (!onViewChange) return;
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const nextZoom = clampZoom(zoom * factor);
    if (nextZoom !== zoom) onViewChange({ zoom: nextZoom });
  };

  const onMouseDownWorld: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (mode === "pan" || e.button === 2) {
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

  // ---- selection helpers ----
  const onBackgroundClick = () => onClearSelection?.();

  // ---- linking ----
  type PortRef = { deviceId: string; portName: string; dir: "IN" | "OUT"; x: number; y: number };
  const [linkFrom, setLinkFrom] = useState<PortRef | null>(null);
  const [mouse, setMouse] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const toWorld = (clientX: number, clientY: number) => {
    const rect = (wrapRef.current as HTMLDivElement).getBoundingClientRect();
    const sx = clientX - rect.left - pan.x;
    const sy = clientY - rect.top - pan.y;
    return { x: sx / zoom, y: sy / zoom };
  };

  const tryFinishLink = (to: PortRef) => {
    if (!graph || !onChange || !linkFrom) return;
    const a = linkFrom.dir;
    const b = to.dir;
    const from = a === "OUT" ? linkFrom : to;
    const dest = a === "OUT" ? to : linkFrom;
    if (from.dir !== "OUT" || dest.dir !== "IN") return;
    if (from.deviceId === dest.deviceId && from.portName === dest.portName) return;

    const id = nextConnectionIdFor(graph);
    onChange({
      ...graph,
      connections: [
        ...graph.connections,
        {
          id,
          from: { deviceId: from.deviceId, portName: from.portName },
          to: { deviceId: dest.deviceId, portName: dest.portName },
        },
      ],
    });
  };

  const onMouseMoveWorld: React.MouseEventHandler<HTMLDivElement> = (e) => {
    const w = toWorld(e.clientX, e.clientY);
    setMouse(w);
  };

  return (
    <div
      ref={wrapRef}
      onWheel={onWheel}
      onContextMenu={onContextMenu}
      onClick={(e) => e.target === wrapRef.current && onBackgroundClick()}
      className="flex-1 min-h-0 rounded-2xl border border-slate-700 bg-slate-900/40 relative overflow-hidden"
    >
      {/* world */}
      <div
        className="absolute inset-0"
        onMouseDown={onMouseDownWorld}
        onMouseMove={onMouseMoveWorld}
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "0 0",
          backgroundImage: showGrid
            ? `
                linear-gradient(to right, rgba(148,163,184,0.12) 1px, transparent 1px),
                linear-gradient(to bottom, rgba(148,163,184,0.12) 1px, transparent 1px)
              `
            : "none",
          backgroundSize: showGrid ? "24px 24px, 24px 24px" : undefined,
        }}
      >
        <div style={{ width: worldW, height: worldH, position: "relative" }}>
          {/* connections */}
          <svg width={worldW} height={worldH} className="absolute inset-0 pointer-events-none">
            {(graph?.connections ?? []).map((c) => {
              const a = deviceMap.get(c.from.deviceId);
              const b = deviceMap.get(c.to.deviceId);
              if (!a || !b) return null;
              const A = centerOf(a);
              const B = centerOf(b);
              return (
                <line
                  key={c.id}
                  x1={A.cx}
                  y1={A.cy}
                  x2={B.cx}
                  y2={B.cy}
                  stroke="rgba(96,165,250,0.75)"
                  strokeWidth={2}
                />
              );
            })}
            {linkFrom && (
              <line
                x1={linkFrom.x}
                y1={linkFrom.y}
                x2={mouse.x}
                y2={mouse.y}
                stroke="rgba(251,191,36,0.9)"
                strokeDasharray="4 4"
                strokeWidth={2}
              />
            )}
          </svg>

          {/* devices */}
          {positioned.map((d) => {
            const isSel = !!selectedIds?.has(d.id);
            const w = d.w ?? BOX_W;
            const h = d.h ?? BOX_H;
            const left = (d.ports ?? []).filter((p) => p.direction === "IN");
            const right = (d.ports ?? []).filter((p) => p.direction === "OUT");

            return (
              <div
                key={d.id}
                style={{ left: d.x, top: d.y, width: w, height: h, cursor: mode === "pan" ? "grab" : "default" }}
                className={`absolute rounded-xl border shadow-sm transition-all
                  ${isSel ? "border-blue-400 ring-2 ring-blue-400/40" : "border-slate-600"}
                  bg-slate-800/80 hover:shadow-md select-none`}
                onMouseDown={(e) => {
                  if (mode !== "select") return;
                  if (e.button !== 0) return;
                  e.stopPropagation();
                  const additive = e.ctrlKey || e.metaKey || e.shiftKey;
                  onToggleSelect?.(d.id, additive);
                  // start drag for all selected
                  const ids = Array.from(new Set([d.id, ...(selectedIds ? Array.from(selectedIds) : [])]));
                  const orig: any = {};
                  ids.forEach((id) => {
                    const dev = deviceMap.get(id)!;
                    orig[id] = { x: dev.x, y: dev.y };
                  });
                  setDrag({ ids, startX: e.clientX, startY: e.clientY, orig });
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onToggleSelect?.(d.id, false);
                }}
                onMouseUp={() => setLinkFrom(null)}
              >
                {/* Header with ID */}
                <div className="px-3 pt-2 text-sm font-semibold text-slate-100 truncate">{d.id}</div>
                <div className="px-3 text-[11px] text-slate-400 flex gap-2">
                  <span>{d.type ?? "device"}</span>
                  {(d as any).manufacturer || (d as any).model ? (
                    <span className="text-slate-500">• {(d as any).manufacturer ?? ""} {(d as any).model ?? ""}</span>
                  ) : null}
                </div>

                {/* Ports */}
                {/* Left (IN) */}
                <div className="absolute left-0 top-0 bottom-0 w-3">
                  {left.map((p, idx) => {
                    const y = ((idx + 1) * h) / (left.length + 1);
                    const pr = { deviceId: d.id, portName: p.name, dir: "IN" as const, x: (d.x ?? 0), y: (d.y ?? 0) + y };
                    return (
                      <div
                        key={p.name}
                        className="absolute -left-[6px]"
                        style={{ top: y - 4 }}
                        title={`${p.name} (${p.type})`}
                        onMouseDown={(e) => {
                          if (mode !== "connect") return;
                          e.stopPropagation();
                          setLinkFrom(pr);
                        }}
                        onMouseUp={(e) => {
                          if (mode !== "connect") return;
                          e.stopPropagation();
                          if (linkFrom) {
                            tryFinishLink(pr);
                            setLinkFrom(null);
                          }
                        }}
                      >
                        <div className="w-2 h-2 rounded-full bg-emerald-400 border border-emerald-300" />
                      </div>
                    );
                  })}
                </div>

                {/* Right (OUT) */}
                <div className="absolute right-0 top-0 bottom-0 w-3">
                  {right.map((p, idx) => {
                    const y = ((idx + 1) * h) / (right.length + 1);
                    const pr = { deviceId: d.id, portName: p.name, dir: "OUT" as const, x: (d.x ?? 0) + w, y: (d.y ?? 0) + y };
                    return (
                      <div
                        key={p.name}
                        className="absolute -right-[6px]"
                        style={{ top: y - 4 }}
                        title={`${p.name} (${p.type})`}
                        onMouseDown={(e) => {
                          if (mode !== "connect") return;
                          e.stopPropagation();
                          setLinkFrom(pr);
                        }}
                        onMouseUp={(e) => {
                          if (mode !== "connect") return;
                          e.stopPropagation();
                          if (linkFrom) {
                            tryFinishLink(pr);
                            setLinkFrom(null);
                          }
                        }}
                      >
                        <div className="w-2 h-2 rounded-full bg-sky-400 border border-sky-300" />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* hint */}
      <div className="absolute bottom-2 left-3 text-[11px] text-slate-400 bg-black/30 px-2 py-1 rounded">
        Mouse: Select / Drag • Right-drag or Pan tool: Pan • Wheel: Zoom • Connect tool: drag OUT→IN
      </div>
    </div>
  );
}
