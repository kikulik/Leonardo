import React, { useEffect, useMemo, useRef, useState } from "react";

type Device = {
  id: string;
  role?: string;
  x?: number;
  y?: number;
};

type ConnectionEnd = { deviceId: string; portId?: string };
type Connection = { from: ConnectionEnd; to: ConnectionEnd };

export type Graph = {
  devices: Device[];
  connections?: Connection[];
};

type Props = {
  graph?: Graph | null;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onChange?: (next: Graph) => void; // fired when positions change via drag
  showGrid?: boolean;               // show/hide background grid
};

const BOX_W = 160;
const BOX_H = 72;
const GAP_X = 40;
const GAP_Y = 40;
const COLS = 4;

export function Canvas({
  graph,
  selectedId,
  onSelect,
  onChange,
  showGrid = true,
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
      return { ...d, x, y };
    });

    const w =
      (Math.min(out.length - 1, COLS - 1) + 1) * (BOX_W + GAP_X) + 80 || 800;
    const rows = Math.ceil(out.length / COLS);
    const h = rows * (BOX_H + GAP_Y) + 120 || 600;
    return { positioned: out, width: Math.max(w, 800), height: Math.max(h, 600) };
  }, [devices]);

  // ---- dragging state ----
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

  // global mouse handlers while dragging
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!drag || !graph || !onChange) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;

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
  }, [drag, graph, onChange]);

  // click background to clear selection
  const onBackgroundClick = (e: React.MouseEvent) => {
    if (e.target === wrapRef.current) onSelect?.(null);
  };

  return (
    <div
      ref={wrapRef}
      onMouseDown={() => {
        /* reserve for keyboard focus later */
      }}
      onClick={onBackgroundClick}
      className="m-4 h-[calc(100%-2rem)] rounded-2xl border border-slate-700 bg-slate-900/40 relative overflow-auto"
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
            <div className="absolute inset-0" style={{ background: "url(#)" }}>
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
                width: BOX_W,
                height: BOX_H,
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
                // start drag
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
                {d.id}
              </div>
              <div className="px-3 text-xs text-slate-400">
                {d.role ?? "device"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
