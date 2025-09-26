// frontend/src/lib/editor.ts

// ---------- Types ----------
export type PortDirection = "IN" | "OUT";
export type PortType = "SDI" | "IP" | "HDMI" | "AUDIO" | string;
export function clampZoom(z: number, min = 0.3, max = 2) {
  return Math.min(max, Math.max(min, z));
}

export interface Port {
  name: string;
  type: PortType;
  direction: PortDirection;
}

export interface Device {
  id: string;            // e.g. CAM.01
  type: string;          // e.g. "camera", "mixer"
  x: number;
  y: number;
  w: number;
  h: number;
  color?: string;
  customName?: string;   // optional label (NOT shown in header now)
  manufacturer?: string;
  model?: string;
  ports: Port[];
}

export interface ConnectionEnd {
  deviceId: string;
  portName: string;
}

export interface Connection {
  id: string; // e.g. CONN-0001
  from: ConnectionEnd;
  to: ConnectionEnd;
}

export interface GraphState {
  devices: Device[];
  connections: Connection[];
}

// ---------- Prefix mapping ----------
const TYPE_PREFIX: Record<string, string> = {
  camera: "CAM",
  ccu: "CCU",
  routing: "RTR",
  mixer: "MIX",
  monitoring: "MON",
  recording: "REC",
  converter: "CNV",
  transmission: "TX",
  sync: "SYNC",
  audio: "AUD",
  patch_panels: "PATCH",
};

// ---------- ID helpers (state-aware) ----------
export function nextDeviceIdForType(state: GraphState, type: string) {
  const prefix = TYPE_PREFIX[type?.toLowerCase()] || "DEV";
  // find max numeric suffix for this prefix
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
  const n = name.toLowerCase().trim();
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

// ---------- Mutators (pure; return new copies) ----------
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

  const newDevices: Device[] = [];
  let draft = { ...state };

  for (let i = 0; i < count; i++) {
    const id = nextDeviceIdForType(draft, type);
    const customName = customNameBase ? `${customNameBase} ${i + 1}` : undefined;
    const d: Device = {
      id,
      type,
      x: x + i * 40,
      y: y + i * 40,
      w,
      h,
      color,
      customName,
      manufacturer,
      model,
      ports: [...defaultPorts],
    };
    draft = { ...draft, devices: [...draft.devices, d] };
    newDevices.push(d);
  }
  return draft;
}

export function addPortsToDevice(
  state: GraphState,
  payload: {
    deviceName: string; // id or customName
    ports: Array<{ portType: PortType; direction: PortDirection; quantity: number }>;
  }
): GraphState {
  const { deviceName, ports } = payload;
  const device = findDeviceByIdOrName(state.devices, deviceName);
  if (!device) throw new Error(`Device "${deviceName}" not found.`);

  const updated = { ...device, ports: [...(device.ports ?? [])] };

  ports.forEach((p) => {
    const { portType, direction, quantity } = p;
    for (let i = 0; i < quantity; i++) {
      // find unique name
      let counter = updated.ports.length + 1;
      let candidate = "";
      const existing = new Set(updated.ports.map((pp) => pp.name));
      do {
        candidate = `${String(portType).toUpperCase()}_${direction
          .toUpperCase()}_${counter++}`;
      } while (existing.has(candidate));

      updated.ports.push({
        name: candidate,
        type: portType.toUpperCase(),
        direction,
      });
    }
  });

  return {
    ...state,
    devices: state.devices.map((d) => (d.id === device.id ? updated : d)),
  };
}

export function createConnection(
  state: GraphState,
  payload: {
    sourceDevice: string;    // id or name
    destDevice: string;      // id or name
    sourcePortName?: string; // if omitted, auto-pick OUT
    destPortName?: string;   // if omitted, auto-pick IN
  }
): GraphState {
  const { sourceDevice, destDevice, sourcePortName, destPortName } = payload;

  const src = findDeviceByIdOrName(state.devices, sourceDevice);
  const dst = findDeviceByIdOrName(state.devices, destDevice);
  if (!src) throw new Error(`Source device "${sourceDevice}" not found.`);
  if (!dst) throw new Error(`Destination device "${destDevice}" not found.`);

  const srcPort =
    sourcePortName || getAvailablePort(src, "OUT" as PortDirection)?.name || "";
  const dstPort =
    destPortName || getAvailablePort(dst, "IN" as PortDirection)?.name || "";

  if (!srcPort || !dstPort)
    throw new Error("No suitable ports found to connect.");

  const conn: Connection = {
    id: nextConnectionIdFor(state),
    from: { deviceId: src.id, portName: srcPort },
    to: { deviceId: dst.id, portName: dstPort },
  };

  return { ...state, connections: [...state.connections, conn] };
}

export function deleteSelectedDevices(
  state: GraphState,
  selectedIds: Set<string>
): GraphState {
  const devices = state.devices.filter((d) => !selectedIds.has(d.id));
  const removedIds = new Set(
    state.devices.map((d) => d.id).filter((id) => !devices.find((d2) => d2.id === id))
  );
  const connections = state.connections.filter(
    (c) => !removedIds.has(c.from.deviceId) && !removedIds.has(c.to.deviceId)
  );
  return { devices, connections };
}

export function copySelectedDevices(
  state: GraphState,
  selectedIds: Set<string>
): Device[] {
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
    const clone: Device = {
      ...d,
      id: newId,
      x: (d.x ?? 0) + offset.x * (i + 1),
      y: (d.y ?? 0) + offset.y * (i + 1),
      ports: [...(d.ports ?? [])],
    };
    draft = { ...draft, devices: [...draft.devices, clone] };
  });
  return draft;
}

// ---------- Save / Load helpers ----------
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
