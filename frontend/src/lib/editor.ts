// frontend/src/lib/editor.ts
// ---------- Types ----------
export type PortDirection = "IN" | "OUT";
export type PortType = "SDI" | "IP" | "HDMI" | "AUDIO" | string;

export interface Port {
  id: string;            // stable uid (doesn't change when name changes)
  name: string;
  type: PortType;
  direction: PortDirection;
}

export interface Device {
  id: string;            // e.g. CAM.01
  type: string;          // logical category
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
  portId: string;
}

export interface Connection {
  id: string; // CONN-0001
  from: ConnectionEnd;   // must be OUT
  to: ConnectionEnd;     // must be IN
}

export interface GraphState {
  devices: Device[];
  connections: Connection[];
}

// ---------- Utils ----------
export function uid() {
  // deterministic enough for UI
  // @ts-ignore
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "p_" + Math.random().toString(36).slice(2, 10);
}

export function clampZoom(z: number, min = 0.25, max = 2.5) {
  return Math.min(max, Math.max(min, z));
}

export const TYPE_PREFIX: Record<string, string> = {
  camera: "CAM",
  router: "RTR",
  "vision mixer": "VMX",
  mixer: "VMX",
  server: "VSRV",
  "camera control unit": "CCU",
  ccu: "CCU",
  embeder: "EMB",
  embedder: "EMB",
  encoder: "ENC",
  "replay system": "SLO",
  replay: "SLO",
  monitors: "MON",
  monitor: "MON",
  audio: "AUD",
  converter: "CNV",
  transmission: "TX",
  sync: "SYNC",
  patch_panels: "PATCH",
};

export function nextDeviceIdForType(state: GraphState, type: string) {
  const prefix = TYPE_PREFIX[type?.toLowerCase()] || "DEV";
  let maxNum = 0;
  const rx = new RegExp(`^${prefix}\\.(\\d+)$`, "i");
  for (const d of state.devices) {
    const m = d.id.match(rx);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n)) maxNum = Math.max(maxNum, n);
    }
  }
  const next = maxNum + 1;
  return `${prefix}.${String(next).padStart(2, "0")}`;
}

export function nextConnectionIdFor(state: GraphState) {
  let maxNum = 0;
  const rx = /^CONN-(\d+)$/i;
  for (const c of state.connections) {
    const m = c.id.match(rx);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n)) maxNum = Math.max(maxNum, n);
    }
  }
  const next = maxNum + 1;
  return `CONN-${String(next).padStart(4, "0")}`;
}

// ---------- Finders ----------
export function findDevice(devs: Device[], id: string) {
  return devs.find((d) => d.id === id);
}
export function getPorts(device: Device, dir: PortDirection) {
  return (device.ports ?? []).filter((p) => p.direction === dir);
}
export function getPortById(device: Device, portId: string) {
  return (device.ports ?? []).find((p) => p.id === portId);
}

// ---------- Snap / movement ----------
export function snap(value: number, cell = 16) {
  return Math.round(value / cell) * cell;
}
export function moveDevice(
  d: Device,
  dx: number,
  dy: number,
  opts?: { snapToGrid?: boolean; gridSize?: number }
): Device {
  const nx = (d.x ?? 0) + dx;
  const ny = (d.y ?? 0) + dy;
  if (opts?.snapToGrid) {
    const gs = opts.gridSize ?? 16;
    return { ...d, x: snap(nx, gs), y: snap(ny, gs) };
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
    defaultPorts?: Omit<Port, "id">[] | Port[];
    manufacturer?: string;
    model?: string;
  }
): GraphState {
  const {
    type,
    count = 1,
    x = 80,
    y = 80,
    w = 160,
    h = 80,
    color = "#334155",
    customNameBase,
    defaultPorts = [],
    manufacturer,
    model,
  } = payload;

  const normalizePorts = (arr: (Omit<Port, "id"> | Port)[]): Port[] =>
    arr.map((p) => ({ id: (p as Port).id ?? uid(), name: p.name, type: p.type, direction: p.direction }));

  let draft = { ...state };
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
          w,
          h,
          color,
          customName: customNameBase ? `${customNameBase} ${i + 1}` : undefined,
          manufacturer,
          model,
          ports: normalizePorts(defaultPorts),
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
  const devices = state.devices.filter((d) => !selectedIds.has(d.id));
  const removed = new Set(state.devices.filter((d) => selectedIds.has(d.id)).map((d) => d.id));
  const connections = state.connections.filter(
    (c) => !removed.has(c.from.deviceId) && !removed.has(c.to.deviceId)
  );
  return { devices, connections };
}

export function copySelectedDevices(
  state: GraphState,
  selectedIds: Set<string>
) {
  return state.devices
    .filter((d) => selectedIds.has(d.id))
    .map((d) => ({
      ...d,
      // duplicate ports with new ids so pasted devices don't alias connections
      ports: (d.ports ?? []).map((p) => ({ ...p, id: uid() })),
    }));
}

export function pasteDevices(
  state: GraphState,
  clipboard: Device[],
  offset = { x: 40, y: 40 }
): GraphState {
  let draft = { ...state };
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
          ports: (d.ports ?? []).map((p) => ({ ...p, id: uid() })),
        },
      ],
    };
  });
  return draft;
}

export function addConnection(
  state: GraphState,
  from: ConnectionEnd,
  to: ConnectionEnd
): GraphState {
  const fromDev = findDevice(state.devices, from.deviceId);
  const toDev = findDevice(state.devices, to.deviceId);
  if (!fromDev || !toDev) return state;

  const fromPort = getPortById(fromDev, from.portId);
  const toPort = getPortById(toDev, to.portId);
  if (!fromPort || !toPort) return state;

  // enforce OUT -> IN only
  if (!(fromPort.direction === "OUT" && toPort.direction === "IN")) return state;

  // prevent duplicates
  const dupe = state.connections.some(
    (c) => c.from.deviceId === from.deviceId && c.from.portId === from.portId &&
           c.to.deviceId === to.deviceId && c.to.portId === to.portId
  );
  if (dupe) return state;

  // NEW: one OUT may have only one connection
  const outUsed = state.connections.some(
    (c) => c.from.deviceId === from.deviceId && c.from.portId === from.portId
  );
  if (outUsed) return state;

  const id = nextConnectionIdFor(state);
  return { ...state, connections: [...state.connections, { id, from, to }] };
}

// ---------- Save / Load ----------
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
