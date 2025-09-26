// ---------- Types ----------
export type PortDirection = "IN" | "OUT";
export type PortType = "SDI" | "IP" | "HDMI" | "AUDIO" | string;

export interface Port {
  name: string;
  type: PortType;
  direction: PortDirection;
}

export interface Device {
  id: string;            // e.g. CAM.01
  type: string;          // logical category ("camera", "router", ...)
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
  portName: string;
}

export interface Connection {
  id: string; // CONN-0001
  from: ConnectionEnd;
  to: ConnectionEnd;
}

export interface GraphState {
  devices: Device[];
  connections: Connection[];
}

// ---------- Visual helpers ----------
export function clampZoom(z: number, min = 0.25, max = 2.5) {
  return Math.min(max, Math.max(min, z));
}

// ---------- Type → Prefix map (expanded) ----------
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

// ---------- ID helpers (state-aware) ----------
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
export function findDeviceByIdOrName(devices: Device[], name: string) {
  const n = (name || "").toLowerCase().trim();
  return devices.find(
    (d) =>
      d.id.toLowerCase() === n ||
      (d.customName && d.customName.toLowerCase() === n)
  );
}

export function getAvailablePort(
  device: Device,
  direction: PortDirection,
  preferType?: PortType
) {
  const ports = (device.ports ?? []).filter((p) => p.direction === direction);
  if (!ports.length) return undefined;
  if (preferType) {
    const typed = ports.find((p) => p.type.toUpperCase() === preferType.toUpperCase());
    if (typed) return typed;
  }
  return ports[0];
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
    defaultPorts?: Port[];
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
          ports: [...defaultPorts],
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
    .map((d) => ({ ...d, ports: [...(d.ports ?? [])] }));
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
          x: d.x + offset.x * (i + 1),
          y: d.y + offset.y * (i + 1),
          ports: [...(d.ports ?? [])],
        },
      ],
    };
  });
  return draft;
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
