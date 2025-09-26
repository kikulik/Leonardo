// frontend/src/lib/editor.ts

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
  type: string;          // e.g. "camera", "mixer"
  x: number;
  y: number;
  w: number;
  h: number;
  color?: string;
  customName?: string;   // user label
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

export interface AddDevicePayload {
  type: string;
  count?: number;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  color?: string;
  customNameBase?: string; // prefix for custom names like "Camera"
  defaultPorts?: Port[];   // optional starter ports
}

export interface AddPortsPayload {
  deviceName: string; // matches device id or customName (case-insensitive)
  ports: Array<{ portType: PortType; direction: PortDirection; quantity: number }>;
}

export interface CreateConnectionPayload {
  sourceDevice: string;    // id or customName
  destDevice: string;      // id or customName
  sourcePortName?: string; // optional, auto-pick if missing
  destPortName?: string;   // optional, auto-pick if missing
}

export interface EditConnectionIdsPayload {
  match: string;   // regex string or substring to find
  replace: string; // replacement
}

// ---------- ID helpers ----------
let deviceCounter = 0;
let connectionCounter = 0;

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

export function nextDeviceId(type: string) {
  deviceCounter += 1;
  const prefix = TYPE_PREFIX[type?.toLowerCase()] || "DEV";
  return `${prefix}.${String(deviceCounter).padStart(2, "0")}`;
}

export function nextConnectionId() {
  connectionCounter += 1;
  return `CONN-${String(connectionCounter).padStart(4, "0")}`;
}

// ---------- Finders ----------
export function findDeviceByName(devices: Device[], name: string) {
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
  const ports = device.ports.filter((p) => p.direction === direction);
  if (preferType) {
    const typed = ports.find((p) => p.type.toUpperCase() === preferType.toUpperCase());
    if (typed) return typed;
  }
  return ports[0];
}

// ---------- Mutators (pure-ish; return new copies) ----------
export function addDevice(
  state: GraphState,
  payload: AddDevicePayload
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
  } = payload;

  let { devices } = state;
  const newDevices: Device[] = [];

  for (let i = 0; i < count; i++) {
    const id = nextDeviceId(type);
    const customName =
      customNameBase ? `${customNameBase} ${i + 1}` : undefined;
    newDevices.push({
      id,
      type,
      x: x + i * 40,
      y: y + i * 40,
      w,
      h,
      color,
      customName,
      ports: [...defaultPorts],
    });
  }

  return { ...state, devices: [...devices, ...newDevices] };
}

export function addPortsToDevice(
  state: GraphState,
  payload: AddPortsPayload
): GraphState {
  const { deviceName, ports } = payload;
  const device = findDeviceByName(state.devices, deviceName);
  if (!device) throw new Error(`Device "${deviceName}" not found.`);

  const updated = { ...device, ports: [...device.ports] };

  ports.forEach((p) => {
    const { portType, direction, quantity } = p;
    for (let i = 0; i < quantity; i++) {
      // find a unique name
      let counter = updated.ports.length + 1;
      let candidate = "";
      const existing = new Set(updated.ports.map((pp) => pp.name));
      do {
        candidate = `${String(portType).toUpperCase()}_${direction
          .slice(0, 3)
          .toUpperCase()}_${counter++}`;
      } while (existing.has(candidate));

      updated.ports.push({
        name: candidate,
        type: portType.toUpperCase(),
        direction: direction.toUpperCase() as PortDirection,
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
  payload: CreateConnectionPayload
): GraphState {
  const { sourceDevice, destDevice, sourcePortName, destPortName } = payload;

  const src = findDeviceByName(state.devices, sourceDevice);
  const dst = findDeviceByName(state.devices, destDevice);
  if (!src) throw new Error(`Source device "${sourceDevice}" not found.`);
  if (!dst) throw new Error(`Destination device "${destDevice}" not found.`);

  const srcPort =
    sourcePortName ||
    getAvailablePort(src, "OUT" as PortDirection)?.name ||
    "";
  const dstPort =
    destPortName ||
    getAvailablePort(dst, "IN" as PortDirection)?.name ||
    "";

  if (!srcPort || !dstPort)
    throw new Error("No suitable ports found to connect.");

  const connection: Connection = {
    id: nextConnectionId(),
    from: { deviceId: src.id, portName: srcPort },
    to: { deviceId: dst.id, portName: dstPort },
  };

  return { ...state, connections: [...state.connections, connection] };
}

export function editConnectionIds(
  state: GraphState,
  payload: EditConnectionIdsPayload
): GraphState {
  const { match, replace } = payload;
  const rx = new RegExp(match, "g");
  return {
    ...state,
    connections: state.connections.map((c) => ({
      ...c,
      id: c.id.replace(rx, replace),
    })),
  };
}

// ---------- Selection / Clipboard ----------
export function deleteSelectedDevices(
  state: GraphState,
  selectedIds: Set<string>
): GraphState {
  const devices = state.devices.filter((d) => !selectedIds.has(d.id));
  const removedIds = new Set(state.devices.map((d) => d.id).filter((id) => !devices.find((d) => d.id === id)));
  const connections = state.connections.filter(
    (c) => !removedIds.has(c.from.deviceId) && !removedIds.has(c.to.deviceId)
  );
  return { devices, connections };
}

export function copySelectedDevices(
  state: GraphState,
  selectedIds: Set<string>
): Device[] {
  return state.devices.filter((d) => selectedIds.has(d.id)).map((d) => ({ ...d, ports: [...d.ports] }));
}

export function pasteDevices(
  state: GraphState,
  clipboard: Device[],
  offset = { x: 40, y: 40 }
): GraphState {
  const clones: Device[] = clipboard.map((d, i) => ({
    ...d,
    id: nextDeviceId(d.type),
    x: d.x + offset.x * (i + 1),
    y: d.y + offset.y * (i + 1),
    ports: [...d.ports],
  }));
  return { ...state, devices: [...state.devices, ...clones] };
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

export async function loadProjectFromFile(
  file: File
): Promise<GraphState> {
  const text = await file.text();
  const parsed = JSON.parse(text);
  // very light validation
  if (!parsed.devices || !parsed.connections) {
    throw new Error("Invalid project file.");
  }
  return parsed as GraphState;
}

// ---------- Small utilities ----------
export function toggleGrid(current: boolean) {
  return !current;
}

export function clampZoom(z: number, min = 0.25, max = 3) {
  return Math.max(min, Math.min(max, z));
}
