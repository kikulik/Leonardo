// frontend/src/lib/editor.ts

// ---------- Types ----------
export type PortDirection = "IN" | "OUT";
export type PortType = string;

export interface Port {
  id: string;
  name: string;
  type: PortType;
  direction: PortDirection;
}

export interface Device {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color?: string;
  customName?: string;
  manufacturer?: string;
  model?: string;
  ports: Port[];
}

export interface ConnectionEnd {
  deviceId: string;
  portName: string; // keep by name for compatibility
}

export interface Connection {
  id: string;
  from: ConnectionEnd; // OUT
  to: ConnectionEnd;   // IN
}

export interface GraphState {
  devices: Device[];
  connections: Connection[];
}

// ---------- Utils ----------
export function clampZoom(z: number, min = 0.25, max = 2.5) {
  return Math.min(max, Math.max(min, z));
}

const TYPE_PREFIX: Record<string, string> = {
  camera: "CAM",
  router: "RTR",
  "vision mixer": "VMX",
  mixer: "VMX",
  server: "SRV",
  "camera control unit": "CCU",
  ccu: "CCU",
  embeder: "EMB",
  embedder: "EMB",
  encoder: "ENC",
  "replay system": "SLO",
  monitors: "MON",
  monitor: "MON",
};

function uid(prefix = "p") {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now()
    .toString(36)
    .slice(-4)}`;
}

export function nextDeviceIdForType(state: GraphState, type: string) {
  const prefix = TYPE_PREFIX[type?.toLowerCase()] || "DEV";
  const rx = new RegExp(`^${prefix}\\.(\\d+)$`, "i");
  let n = 0;
  for (const d of state.devices) {
    const m = d.id.match(rx);
    if (m) n = Math.max(n, parseInt(m[1], 10) || 0);
  }
  return `${prefix}.${String(n + 1).padStart(2, "0")}`;
}

export function nextConnectionIdFor(state: GraphState) {
  const rx = /^CONN-(\d+)$/i;
  let n = 0;
  for (const c of state.connections) {
    const m = c.id.match(rx);
    if (m) n = Math.max(n, parseInt(m[1], 10) || 0);
  }
  return `CONN-${String(n + 1).padStart(4, "0")}`;
}

// Ensure every port has a stable id
export function normalizePorts(ports: Partial<Port>[]): Port[] {
  return (ports || []).map((p) => ({
    id: p.id || uid("port"),
    name: p.name || "PORT",
    type: (p.type || "GEN").toUpperCase(),
    direction: ((p.direction as PortDirection) || "IN"),
  }));
}

export function withPortIds(state: GraphState): GraphState {
  return {
    ...state,
    devices: state.devices.map((d) => ({
      ...d,
      ports: normalizePorts(d.ports),
    })),
  };
}

// ---------- Movement ----------
export function moveDevice(
  d: Device,
  dx: number,
  dy: number,
  opts?: { snapToGrid?: boolean; gridSize?: number }
): Device {
  const nx = (d.x ?? 0) + dx;
  const ny = (d.y ?? 0) + dy;
  if (opts?.snapToGrid) {
    const g = opts.gridSize ?? 16;
    return { ...d, x: Math.round(nx / g) * g, y: Math.round(ny / g) * g };
  }
  return { ...d, x: nx, y: ny };
}

// ---------- Mutators ----------
export function addDevice(
  state: GraphState,
  payload: {
    type: string;
    count?: number;
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    color?: string;
    customNameBase?: string;
    defaultPorts?: Partial<Port>[];
    manufacturer?: string;
    model?: string;
  }
): GraphState {
  const {
    type,
    count = 1,
    x = 80,
    y = 80,
    w,
    h,
    color = "#334155",
    customNameBase,
    defaultPorts = [],
    manufacturer,
    model,
  } = payload;

  const portsNorm = normalizePorts(defaultPorts);
  const INs = portsNorm.filter((p) => p.direction === "IN");
  const OUTs = portsNorm.filter((p) => p.direction === "OUT");
  const maxPorts = Math.max(INs.length, OUTs.length);

  // Match Canvas sizing rules (header excluded from spacing)
  const HEADER_H = 36;
  const BODY_PAD_TOP = 15;
  const BODY_PAD_BOTTOM = 15;
  const PORT_FONT = 10;
  const PIN_INSET = 7;

  const minPortSpacing = 24;
  const minInnerHeight = maxPorts > 1 ? (maxPorts - 1) * minPortSpacing : 20;
  const autoH = Math.max(
    80,
    HEADER_H + BODY_PAD_TOP + BODY_PAD_BOTTOM + minInnerHeight
  );

  const CHAR_W = Math.ceil(PORT_FONT * 0.6);
  const leftLen = INs.reduce((m, p) => Math.max(m, (p.name || "").length), 0);
  const rightLen = OUTs.reduce((m, p) => Math.max(m, (p.name || "").length), 0);
  const MIDDLE_GAP = 24;
  const PIN_AND_TEXT = 2 * (PIN_INSET + 9);
  const autoW = Math.max(
    160,
    PIN_AND_TEXT + leftLen * CHAR_W + rightLen * CHAR_W + MIDDLE_GAP
  );

  let draft: GraphState = withPortIds({ ...state });
  for (let i = 0; i < count; i++) {
    const id = nextDeviceIdForType(draft, type);
    draft = {
      ...draft,
      devices: [
        ...draft.devices,
        {
          id,
          type,
          x: x + i * 40,
          y: y + i * 40,
          w: Math.max(w ?? 0, autoW),
          h: Math.max(h ?? 0, autoH),
          color,
          customName: customNameBase ? `${customNameBase} ${i + 1}` : undefined,
          manufacturer,
          model,
          ports: portsNorm,
        },
      ],
    };
  }
  return draft;
}

export function deleteSelectedDevices(
  state: GraphState,
  selectedIds: Set<string>
): GraphState {
  const keep = new Set(
    state.devices.filter((d) => !selectedIds.has(d.id)).map((d) => d.id)
  );
  return {
    devices: state.devices.filter((d) => keep.has(d.id)),
    connections: state.connections.filter(
      (c) => keep.has(c.from.deviceId) && keep.has(c.to.deviceId)
    ),
  };
}

export function copySelectedDevices(state: GraphState, selectedIds: Set<string>) {
  return state.devices
    .filter((d) => selectedIds.has(d.id))
    .map((d) => ({ ...d, ports: d.ports.map((p) => ({ ...p })) }));
}

export function pasteDevices(
  state: GraphState,
  clipboard: Device[],
  offset = { x: 40, y: 40 }
): GraphState {
  let draft = withPortIds({ ...state });
  clipboard.forEach((d, i) => {
    const newId = nextDeviceIdForType(draft, d.type);
    draft = {
      ...draft,
      devices: [
        ...draft.devices,
        {
          ...d,
          id: newId,
          x: (d.x ?? 0) + offset.x * (i + 1),
          y: (d.y ?? 0) + offset.y * (i + 1),
          ports: normalizePorts(d.ports),
        },
      ],
    };
  });
  return draft;
}

// Connections: OUT→IN only, no fan-out, no multi-in duplicates.
export function addConnection(
  state: GraphState,
  from: ConnectionEnd,
  to: ConnectionEnd
): GraphState {
  const fromDev = state.devices.find((d) => d.id === from.deviceId);
  const toDev = state.devices.find((d) => d.id === to.deviceId);
  if (!fromDev || !toDev) return state;

  const fromPort = fromDev.ports.find((p) => p.name === from.portName);
  const toPort = toDev.ports.find((p) => p.name === to.portName);
  if (!fromPort || !toPort) return state;
  if (!(fromPort.direction === "OUT" && toPort.direction === "IN")) return state;

  // prevent duplicates
  const dupe = state.connections.some(
    (c) =>
      c.from.deviceId === from.deviceId &&
      c.from.portName === from.portName &&
      c.to.deviceId === to.deviceId &&
      c.to.portName === to.portName
  );
  if (dupe) return state;

  // forbid fan-out on OUT
  const outUsed = state.connections.some(
    (c) => c.from.deviceId === from.deviceId && c.from.portName === from.portName
  );
  if (outUsed) return state;

  // forbid multiple connections into one IN
  const inUsed = state.connections.some(
    (c) => c.to.deviceId === to.deviceId && c.to.portName === to.portName
  );
  if (inUsed) return state;

  const id = nextConnectionIdFor(state);
  return { ...state, connections: [...state.connections, { id, from, to }] };
}

// ---------- Save ----------
export function serialize(state: GraphState) {
  return JSON.stringify(state, null, 2);
}

export function downloadJson(filename: string, jsonText: string) {
  const blob = new Blob([jsonText], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function saveProject(state: GraphState, filename = "project.json") {
  downloadJson(filename, serialize(state));
}
