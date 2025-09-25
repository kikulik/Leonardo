import React, { useMemo } from "react";

type Device = {
  id: string;
  role?: string;
  // optional absolute position (pixels)
  x?: number;
  y?: number;
};

type ConnectionEnd = { deviceId: string; portId?: string };
type Connection = { from: ConnectionEnd; to: ConnectionEnd };

type Graph = {
  devices: Device[];
  connections?: Connection[];
};

type Props = {
  graph?: Graph | null;
};

/**
 * Minimal, self-contained canvas renderer:
 * - If a device has x/y, we use it.
 * - Otherwise we auto-layout in a tidy grid.
 * - Connections are drawn as straight SVG lines (center-to-center).
 */
export function Canvas({ graph }: Props) {
  const devices = graph?.devices ?? [];
  const deviceMap = useMemo(
    () => new Map(devices.map((d) => [d.id, d])),
    [devices]
  );

  // compute positions
  const { positioned, width, height } = useMemo(() => {
    const boxW = 160;
    const boxH = 72;
    const gapX = 40;
    const gapY = 40;
    const cols = 4;

    const out = devices.map((d, i) => {
      if (typeof d.x === "number" && typeof d.y === "number") return d;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = 40 + col * (boxW + gapX);
      const y = 40 + row * (boxH + gapY);
      return { ...d, x, y };
    });

    const last = out[out.length - 1];
    const w =
      (Math.min(out.length - 1, cols - 1) + 1) * (boxW + gapX) + 80 || 800;
    const rows = Math.ceil(out.length / cols);
    const h = rows * (boxH + gapY) + 120 || 600;
    return { positioned: out, width: Math.max(w, 800), height: Math.max(h, 600) };
  }, [devices]);

  // connection line helpers
  function centerOf(d: Device) {
    return { cx: (d.x ?? 0) + 80, cy: (d.y ?? 0) + 36 };
  }

  const connections = graph?.connections ?? [];

  return (
    <div className="m-4 h-[calc(100%-2rem)] rounded-2xl border border-slate-700 bg-slate-900/40 relative overflow-auto">
      <div style={{ width, height, position: "relative" }}>
        {/* grid */}
        <svg width={width} height={height} className="absolute inset-0">
          <defs>
            <pattern id="minor-grid" width="24" height="24" patternUnits="userSpaceOnUse">
              <path d="M 24 0 L 0 0 0 24" fill="none" stroke="rgba(148,163,184,0.12)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#minor-grid)" />
        </svg>

        {/* connections */}
        <svg width={width} height={height} className="absolute inset-0 pointer-events-none">
          {connections.map((c, i) => {
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
        {positioned.map((d) => (
          <div
            key={d.id}
            style={{ left: d.x, top: d.y, width: 160, height: 72 }}
            className="absolute rounded-xl border border-slate-600 bg-slate-800/80 shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="px-3 pt-2 text-sm font-medium text-slate-100">{d.id}</div>
            <div className="px-3 text-xs text-slate-400">{d.role ?? "device"}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
