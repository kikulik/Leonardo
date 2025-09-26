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
};

const BOX_W = 160;
const BOX_H = 80;

/** Port endpoint in WORLD coordinates (unscaled/untranslated) */
function portWorldPos(device: Device, portName: string, dir: "IN" | "OUT") {
  const w = device.w ?? BOX_W;
  const h = device.h ?? BOX_H;
  const left = (device.ports ?? []).filter((p) => p.direction === "IN");
  const right = (device.ports ?? []).filter((p) => p.direction === "OUT");
  if (dir === "IN") {
    const idx = left.findIndex((p) => p.name === portName);
    const y = ((idx + 1) * h) / (left.length + 1);
    return { x: (device.x ?? 0), y: (device.y ?? 0) + y };
  }
  const idx = right.findIndex((p) => p.name === portName);
  const y = ((idx + 1) * h) / (right.length + 1);
  return { x: (device.x ?? 0) + w, y: (device.y ?? 0) + y };
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
}: Props) {
  const devices = graph?.devices ?? [];
  const deviceMap = useMemo(
    () => new Map(devices.map((d) => [d.id, d])),
    [devices]
  );

  const wrapRef = useRef<HTMLDivElement | null>(null);

  // ----- GRID overlay (view-space), always fills screen -----
  const gridCell = Math.max(8, Math.round(24 * zoom)); // scale with zoom
  const gridPosX = ((pan.x % gridCell) + gridCell) % gridCell;
  const gridPosY = ((pan.y % gridCell) + gridCell) % gridCell;

  // ----- DRAG DEVICES -----
  const [drag, setDrag] = useState<{
    ids: string[];
    startX: number;
    startY: number;
    orig: Record<string, { x: number; y: number }>;
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

  // ----- PAN / ZOOM -----
  const [panning, setPanning] = useState<{ sx: number; sy: number; px: number; py: number } | null>(null);

  const onWheel: React.WheelEventHandler = (e) => {
    if (!onViewChange) return;
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const next = clampZoom(zoom * factor);
    if (next !== zoom) onViewChange({ zoom: next });
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

  // ----- SELECTION -----
  const onBackgroundClick = () => onClearSelection?.();

  // ----- LINKING (OUT→IN) -----
  type PortRef = { deviceId: string; portName: string; dir: "IN" | "OUT" };
  const [linkFrom, setLinkFrom] = useState<PortRef | null>(null);
  const [mouseWorld, setMouseWorld] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const toWorld = (clientX: number, clientY: number) => {
    const rect = (wrapRef.current as HTMLDivElement).getBoundingClientRect();
    return { x: (clientX - rect.left - pan.x) / zoom, y: (clientY - rect.top - pan.y) / zoom };
  };

  const tryFinishLink = (to: PortRef) => {
    if (!graph || !onChange || !linkFrom) return;
    const a = linkFrom.dir, b = to.dir;
    const from = a === "OUT" ? linkFrom : to;
    const dest = a === "OUT" ? to : linkFrom;
    if (from.dir !== "OUT" || dest.dir !== "IN") return;
    if (from.deviceId === dest.deviceId && from.portName === dest.portName) return;

    const id = nextConnectionIdFor(graph);
    onChange({
      ...graph,
      connections: [
        ...graph.connections,
        { id, from: { deviceId: from.deviceId, portName: from.portName }, to: { deviceId: dest.deviceId, portName: dest.portName } },
      ],
    });
    setLinkFrom(null);
  };

  const onMouseMoveWorld: React.MouseEventHandler<HTMLDivElement> = (e) => {
    setMouseWorld(toWorld(e.clientX, e.clientY));
  };

  // ----- RENDER -----
  return (
    <div
      ref={wrapRef}
      className="flex-1 min-h-0 rounded-2xl border border-slate-700 bg-transparent relative overflow-hidden"
      onWheel={onWheel}
      onContextMenu={onContextMenu}
      onClick={(e) => e.target === wrapRef.current && onBackgroundClick()}
    >
      {/* GRID overlay (screen-space) */}
      {showGrid && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `
              linear-gradient(to right, rgba(148,163,184,0.12) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(148,163,184,0.12) 1px, transparent 1px)
            `,
            backgroundSize: `${gridCell}px ${gridCell}px, ${gridCell}px ${gridCell}px`,
            backgroundPosition: `${gridPosX}px ${gridPosY}px, ${gridPosX}px ${gridPosY}px`,
          }}
        />
      )}

      {/* WORLD (transformed) */}
      <div
        className="absolute inset-0"
        onMouseDown={onMouseDownWorld}
        onMouseMove={onMouseMoveWorld}
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "0 0" }}
      >
        {/* connections */}
        <svg width={200000} height={200000} className="absolute inset-0 pointer-events-none">
          {(graph?.connections ?? []).map((c) => {
            const Adev = deviceMap.get(c.from.deviceId);
            const Bdev = deviceMap.get(c.to.deviceId);
            if (!Adev || !Bdev) return null;
            const A = portWorldPos(Adev, c.from.portName, "OUT");
            const B = portWorldPos(Bdev, c.to.portName, "IN");
            return (
              <line
                key={c.id}
                x1={A.x}
                y1={A.y}
                x2={B.x}
                y2={B.y}
                stroke="rgba(96,165,250,0.85)"
                strokeWidth={2}
              />
            );
          })}
          {linkFrom && (() => {
            const fromDev = deviceMap.get(linkFrom.deviceId)!;
            const P = portWorldPos(fromDev, linkFrom.portName, linkFrom.dir);
            return (
              <line
                x1={P.x}
                y1={P.y}
                x2={mouseWorld.x}
                y2={mouseWorld.y}
                stroke="rgba(251,191,36,0.95)"
                strokeDasharray="6 4"
                strokeWidth={2}
              />
            );
          })()}
        </svg>

        {/* devices */}
        {devices.map((d) => {
          const isSel = !!selectedIds?.has(d.id);
          const w = d.w ?? BOX_W;
          const h = d.h ?? BOX_H;
          const left = (d.ports ?? []).filter((p) => p.direction === "IN");
          const right = (d.ports ?? []).filter((p) => p.direction === "OUT");

          return (
            <div
              key={d.id}
              className={`absolute rounded-xl bg-slate-800/85 border transition-all
                ${isSel ? "border-blue-400 ring-2 ring-blue-400/40" : "border-slate-600"} select-none`}
              style={{ left: d.x, top: d.y, width: w, height: h }}
              onMouseDown={(e) => {
                if (mode !== "select" || e.button !== 0) return;
                e.stopPropagation();
                const additive = e.ctrlKey || e.metaKey || e.shiftKey;
                const isAlready = !!selectedIds?.has(d.id);

                // selection rules to avoid "hidden extra move" bug:
                // - if clicked is selected and not additive -> drag currently selected set
                // - if clicked is not selected and not additive -> select ONLY clicked and drag it
                // - if additive -> toggle selection; drag ONLY clicked
                if (additive) {
                  onToggleSelect?.(d.id, true);
                } else if (!isAlready) {
                  onToggleSelect?.(d.id, false);
                }

                const idsToDrag =
                  !additive && isAlready ? Array.from(selectedIds ?? new Set([d.id])) : [d.id];

                const orig: Record<string, { x: number; y: number }> = {};
                idsToDrag.forEach((id) => {
                  const dev = deviceMap.get(id)!;
                  orig[id] = { x: dev.x, y: dev.y };
                });
                setDrag({ ids: idsToDrag, startX: e.clientX, startY: e.clientY, orig });
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onToggleSelect?.(d.id, false);
              }}
              onMouseUp={() => setLinkFrom(null)}
            >
              {/* header */}
              <div className="px-3 pt-2 text-sm font-semibold text-slate-100 truncate">{d.id}</div>
              <div className="px-3 text-[11px] text-slate-400">{d.type ?? "device"}</div>

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
            </div>
          );
        })}
      </div>

      {/* hint */}
      <div className="absolute bottom-2 left-3 text-[11px] text-slate-400 bg-black/30 px-2 py-1 rounded">
        Mouse: Select/Move • Pan: Right-drag / Pan tool • Wheel: Zoom • Connect: drag OUT → IN
      </div>
    </div>
  );
}
