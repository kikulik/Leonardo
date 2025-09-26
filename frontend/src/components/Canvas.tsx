import React, { useEffect, useMemo, useRef, useState } from "react";
import type { GraphState, Device } from "../lib/editor";
import { clampZoom, nextConnectionIdFor } from "../lib/editor";

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

  snapToGrid?: boolean;
};

const BOX_W = 160;
const BOX_H = 80;

type LinkingEnd = {
  deviceId: string;
  portName: string;
  dir: "IN" | "OUT";
};

/** Port endpoint in WORLD coordinates (unscaled/untranslated) */
function portWorldPos(device: Device, portName: string, dir: "IN" | "OUT") {
  const w = device.w ?? BOX_W;
  const h = device.h ?? BOX_H;
  const left = (device.ports ?? []).filter((p) => p.direction === "IN");
  const right = (device.ports ?? []).filter((p) => p.direction === "OUT");
  if (dir === "IN") {
    const idx = left.findIndex((p) => p.name === portName);
    const y = ((idx + 1) * h) / (left.length + 1);
    return { x: device.x, y: device.y + y };
  }
  const idx = right.findIndex((p) => p.name === portName);
  const y = ((idx + 1) * h) / (right.length + 1);
  return { x: device.x + w, y: device.y + y };
}

function snap(n: number, grid = 16) {
  return Math.round(n / grid) * grid;
}

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
  snapToGrid = false,
}: Props) {
  const devices = graph?.devices ?? [];
  const deviceMap = useMemo(() => new Map(devices.map((d) => [d.id, d])), [devices]);

  const wrapRef = useRef<HTMLDivElement | null>(null);

  // ----- GRID overlay (view-space), always fills screen -----
  const gridCell = Math.max(8, Math.round(24 * zoom)); // scale with zoom
  const gridPosX = ((pan.x % gridCell) + gridCell) % gridCell;
  const gridPosY = ((pan.y % gridCell) + gridCell) % gridCell;

  // ----- DRAG / RESIZE DEVICES -----
  const [drag, setDrag] = useState<
    | null
    | {
        kind: "move";
        id: string;
        startX: number;
        startY: number;
        dx: number;
        dy: number;
      }
    | {
        kind: "resize";
        id: string;
        startX: number;
        startY: number;
        edge:
          | "n"
          | "s"
          | "e"
          | "w"
          | "ne"
          | "nw"
          | "se"
          | "sw";
        orig: { x: number; y: number; w: number; h: number };
      }
  >(null);

  // ----- PAN -----
  const [panning, setPanning] = useState<null | { x: number; y: number; startX: number; startY: number }>(null);

  // ----- LINKING -----
  const [linkFrom, setLinkFrom] = useState<LinkingEnd | null>(null);
  const [mouseWorld, setMouseWorld] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const toWorld = (clientX: number, clientY: number) => {
    const el = wrapRef.current!;
    const rect = el.getBoundingClientRect();
    const vx = clientX - rect.left;
    const vy = clientY - rect.top;
    const wx = (vx - pan.x) / zoom;
    const wy = (vy - pan.y) / zoom;
    return { x: wx, y: wy };
  };

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!wrapRef.current) return;
      if (!onViewChange) return;
      const delta = -e.deltaY * 0.0015;
      const next = clampZoom(zoom * (1 + delta));
      onViewChange({ zoom: next });
    };
    const el = wrapRef.current;
    el?.addEventListener("wheel", onWheel, { passive: true });
    return () => el?.removeEventListener("wheel", onWheel as any);
  }, [zoom, onViewChange]);

  const beginPan = (clientX: number, clientY: number) => {
    setPanning({ x: pan.x, y: pan.y, startX: clientX, startY: clientY });
  };

  const onMouseDownBackground = (e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && mode === "pan") || e.button === 2) {
      beginPan(e.clientX, e.clientY);
      return;
    }
    if (mode === "select") {
      onClearSelection?.();
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const w = toWorld(e.clientX, e.clientY);
    setMouseWorld(w);

    // panning
    if (panning && onViewChange) {
      const dx = e.clientX - panning.startX;
      const dy = e.clientY - panning.startY;
      onViewChange({ pan: { x: panning.x + dx, y: panning.y + dy } });
      return;
    }

    // dragging
    if (!drag || !graph || !onChange) return;

    const idx = graph.devices.findIndex((d) => d.id === (drag as any).id);
    if (idx < 0) return;

    const g = { ...graph, devices: graph.devices.map((d) => ({ ...d })) };
    const d = g.devices[idx];

    if (drag.kind === "move") {
      const dx = (e.movementX / zoom);
      const dy = (e.movementY / zoom);
      d.x += dx;
      d.y += dy;
      if (snapToGrid) {
        d.x = snap(d.x, 8);
        d.y = snap(d.y, 8);
      }
      onChange(g);
    } else if (drag.kind === "resize") {
      const dx = (e.movementX / zoom);
      const dy = (e.movementY / zoom);
      let { x, y, w, h } = drag.orig;

      switch (drag.edge) {
        case "e": w = Math.max(40, d.w = d.w + dx); break;
        case "s": h = Math.max(20, d.h = d.h + dy); break;
        case "w": d.x = d.x + dx; d.w = Math.max(40, d.w - dx); break;
        case "n": d.y = d.y + dy; d.h = Math.max(20, d.h - dy); break;
        case "ne": d.h = Math.max(20, d.h - dy); d.y = d.y + dy; d.w = Math.max(40, d.w + dx); break;
        case "nw": d.h = Math.max(20, d.h - dy); d.y = d.y + dy; d.w = Math.max(40, d.w - dx); d.x = d.x + dx; break;
        case "se": d.w = Math.max(40, d.w + dx); d.h = Math.max(20, d.h + dy); break;
        case "sw": d.w = Math.max(40, d.w - dx); d.x = d.x + dx; d.h = Math.max(20, d.h + dy); break;
      }
      if (snapToGrid) {
        d.x = snap(d.x, 8);
        d.y = snap(d.y, 8);
        d.w = Math.max(40, snap(d.w, 8));
        d.h = Math.max(20, snap(d.h, 8));
      }
      onChange(g);
    }
  };

  const onMouseUp = () => {
    setDrag(null);
    setPanning(null);
  };

  // connect helper (OUT → IN only, pin-to-pin)
  const tryFinishLink = (end: LinkingEnd) => {
    if (!graph || !onChange || !linkFrom) return;
    if (linkFrom.dir === end.dir) return; // require opposite directions
    const from = linkFrom.dir === "OUT" ? linkFrom : end;
    const to = linkFrom.dir === "OUT" ? end : linkFrom;

    const next = { ...graph, connections: [...graph.connections] };
    // prevent duplicates
    const dup = next.connections.some(
      (c) =>
        c.from.deviceId === from.deviceId &&
        c.from.portName === from.portName &&
        c.to.deviceId === to.deviceId &&
        c.to.portName === to.portName
    );
    if (!dup) {
      next.connections.push({
        id: nextConnectionIdFor(next),
        from: { deviceId: from.deviceId, portName: from.portName },
        to: { deviceId: to.deviceId, portName: to.portName },
      });
    }
    onChange(next);
    setLinkFrom(null);
  };

  const connectionPath = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    // cubic with gentle bend
    const dx = Math.max(30, Math.abs(b.x - a.x) * 0.5);
    const c1 = { x: a.x + dx, y: a.y };
    const c2 = { x: b.x - dx, y: b.y };
    return `M ${a.x} ${a.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`;
  };

  // UI
  return (
    <div className="relative w-full h-full bg-slate-900 text-slate-200 select-none">
      {/* GRID */}
      {showGrid && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              `linear-gradient(to right, rgba(148,163,184,0.08) 1px, transparent 1px),` +
              `linear-gradient(to bottom, rgba(148,163,184,0.08) 1px, transparent 1px)`,
            backgroundSize: `${gridCell}px ${gridCell}px`,
            backgroundPosition: `${gridPosX}px ${gridPosY}px`,
          }}
        />
      )}

      {/* WORLD */}
      <div
        ref={wrapRef}
        className="absolute inset-0 overflow-hidden"
        onMouseDown={onMouseDownBackground}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
            width: "100%",
            height: "100%",
            position: "relative",
          }}
        >
          {/* Connections (under devices) */}
          <svg className="absolute inset-0 overflow-visible" style={{ pointerEvents: "none" }}>
            {graph?.connections.map((c) => {
              const aDev = deviceMap.get(c.from.deviceId);
              const bDev = deviceMap.get(c.to.deviceId);
              if (!aDev || !bDev) return null;
              const a = portWorldPos(aDev, c.from.portName, "OUT");
              const b = portWorldPos(bDev, c.to.portName, "IN");
              return (
                <path
                  key={c.id}
                  d={connectionPath(a, b)}
                  fill="none"
                  stroke="rgb(14 165 233)" // sky-500
                  strokeWidth={2}
                />
              );
            })}
            {/* live rubber-band while linking */}
            {linkFrom && (() => {
              const dev = deviceMap.get(linkFrom.deviceId);
              if (!dev) return null;
              const start = portWorldPos(dev, linkFrom.portName, linkFrom.dir);
              const end = mouseWorld;
              return (
                <path
                  d={connectionPath(start, end)}
                  fill="none"
                  stroke="rgb(99 102 241)" // indigo-500
                  strokeDasharray="6 6"
                  strokeWidth={2}
                />
              );
            })()}
          </svg>

          {/* Devices */}
          {(graph?.devices ?? []).map((d) => {
            const selected = selectedIds?.has(d.id) ?? false;
            const w = d.w ?? BOX_W;
            const h = d.h ?? BOX_H;
            const left = (d.ports ?? []).filter((p) => p.direction === "IN");
            const right = (d.ports ?? []).filter((p) => p.direction === "OUT");

            return (
              <div
                key={d.id}
                className="absolute"
                style={{ left: d.x, top: d.y, width: w, height: h }}
                onMouseDown={(e) => {
                  if (mode === "pan") return;
                  if (e.button !== 0) return;
                  e.stopPropagation();
                  onToggleSelect?.(d.id, e.shiftKey || e.metaKey || e.ctrlKey);
                  setDrag({
                    kind: "move",
                    id: d.id,
                    startX: e.clientX,
                    startY: e.clientY,
                    dx: 0,
                    dy: 0,
                  });
                }}
              >
                {/* box */}
                <div
                  className={`w-full h-full rounded-lg border relative`}
                  style={{
                    background: d.color || "#1f2937",
                    borderColor: selected ? "rgb(59 130 246)" : "rgb(71 85 105)",
                    boxShadow: selected ? "0 0 0 3px rgba(59,130,246,0.6)" : "none",
                  }}
                >
                  <div className="absolute left-2 top-2 text-xs opacity-80">{d.id}</div>
                  {d.customName && (
                    <div className="absolute left-2 top-5 text-[11px] opacity-70">{d.customName}</div>
                  )}

                  {/* IN ports (left) */}
                  <div className="absolute left-0 top-0 bottom-0 w-3">
                    {left.map((p, idx) => {
                      const y = ((idx + 1) * h) / (left.length + 1);
                      return (
                        <div
                          key={p.name}
                          className="absolute -left-[6px]"
                          style={{ top: y - 4 }}
                          title={`${p.name} (${p.type})`}
                          onMouseDown={(e) => {
                            if (mode !== "connect") return;
                            e.stopPropagation();
                            setLinkFrom({ deviceId: d.id, portName: p.name, dir: "IN" });
                          }}
                          onMouseUp={(e) => {
                            if (mode !== "connect") return;
                            e.stopPropagation();
                            if (linkFrom) tryFinishLink({ deviceId: d.id, portName: p.name, dir: "IN" });
                          }}
                        >
                          <div className="w-2 h-2 rounded-full bg-emerald-400 border border-emerald-300" />
                        </div>
                      );
                    })}
                  </div>

                  {/* OUT ports (right) */}
                  <div className="absolute right-0 top-0 bottom-0 w-3">
                    {right.map((p, idx) => {
                      const y = ((idx + 1) * h) / (right.length + 1);
                      return (
                        <div
                          key={p.name}
                          className="absolute -right-[6px]"
                          style={{ top: y - 4 }}
                          title={`${p.name} (${p.type})`}
                          onMouseDown={(e) => {
                            if (mode !== "connect") return;
                            e.stopPropagation();
                            setLinkFrom({ deviceId: d.id, portName: p.name, dir: "OUT" });
                          }}
                          onMouseUp={(e) => {
                            if (mode !== "connect") return;
                            e.stopPropagation();
                            if (linkFrom) tryFinishLink({ deviceId: d.id, portName: p.name, dir: "OUT" });
                          }}
                        >
                          <div className="w-2 h-2 rounded-full bg-sky-400 border border-sky-300" />
                        </div>
                      );
                    })}
                  </div>

                  {/* resize handles */}
                  {selected && (
                    <>
                      {["nw","n","ne","e","se","s","sw","w"].map((edge) => {
                        const base = "absolute w-3 h-3 bg-white/70 rounded-sm border border-slate-500";
                        const pos: Record<string, React.CSSProperties> = {
                          n:  { left: "50%", top: -6, transform: "translateX(-50%)", cursor: "ns-resize" },
                          s:  { left: "50%", bottom: -6, transform: "translateX(-50%)", cursor: "ns-resize" },
                          e:  { right: -6, top: "50%", transform: "translateY(-50%)", cursor: "ew-resize" },
                          w:  { left: -6, top: "50%", transform: "translateY(-50%)", cursor: "ew-resize" },
                          ne: { right: -6, top: -6, cursor: "nesw-resize" },
                          nw: { left: -6, top: -6, cursor: "nwse-resize" },
                          se: { right: -6, bottom: -6, cursor: "nwse-resize" },
                          sw: { left: -6, bottom: -6, cursor: "nesw-resize" },
                        };
                        return (
                          <div
                            key={edge}
                            className={base}
                            style={pos[edge]}
                            onMouseDown={(e) => {
                              if (e.button !== 0) return;
                              e.stopPropagation();
                              setDrag({
                                kind: "resize",
                                id: d.id,
                                startX: e.clientX,
                                startY: e.clientY,
                                edge: edge as any,
                                orig: { x: d.x, y: d.y, w: d.w, h: d.h },
                              });
                            }}
                          />
                        );
                      })}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default Canvas;
