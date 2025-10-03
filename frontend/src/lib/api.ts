// frontend/src/lib/api.ts
type Json = Record<string, any>;

// When served via Nginx, /api/* is proxied to backend
const BASE = "";

/* =========================
   Low-level fetch helper
========================= */
async function http<T = Json>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  // Some endpoints (e.g., plain "OK") might be empty
  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}

/* =========================
   Generic app endpoints
========================= */
export async function getCatalog() {
  return http("/catalog");
}

export async function generate(instruction: string) {
  return http("/generate", {
    method: "POST",
    body: JSON.stringify({ prompt: instruction, instruction }),
  });
}

/* =========================
   NetBox Types
========================= */
export type NetboxSite = { id: number; name: string; slug: string };
export type NetboxRole = { id: number; name: string; slug: string };
export type NetboxManufacturer = { id: number; name: string; slug: string };
export type NetboxDeviceType = {
  id: number;
  model: string;
  slug: string;
  manufacturer?: { id: number; name: string; slug: string };
};
export type NetboxDevice = {
  id: number;
  name: string;
  device_role?: { name?: string; slug?: string };
  role?: { name?: string; slug?: string }; // sometimes returned as `role`
  device_type?: { model?: string; slug?: string };
  site?: { name?: string; slug?: string };
};

/* For exporting ports */
export type InterfaceInput = {
  name: string;
  type: string;          // e.g., "1000base-t", "virtual"
  description?: string;
};

export type RearPortInput = {
  name: string;
  type: string;          // e.g., "8p8c", "lc", "bnc"
  positions: number;     // >= 1
  description?: string;
};

export type FrontPortInput = {
  name: string;
  type: string;          // "8p8c", "lc", ...
  rear_port_id: number;  // must be a REAL NetBox rear port id when creating
  rear_port_position: number; // 1..positions
  description?: string;
};

/* =========================
   NetBox Readers
========================= */
export async function fetchNetboxSites(limit = 200, name_ic?: string): Promise<NetboxSite[]> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (name_ic) q.set("name_ic", name_ic);
  const data = await http<{ count: number; results: NetboxSite[] }>(`/netbox/sites?${q.toString()}`);
  return data?.results ?? [];
}

export async function fetchNetboxRoles(limit = 200, name_ic?: string): Promise<NetboxRole[]> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (name_ic) q.set("name_ic", name_ic);
  const data = await http<{ count: number; results: NetboxRole[] }>(`/netbox/roles?${q.toString()}`);
  return data?.results ?? [];
}

export async function fetchNetboxManufacturers(limit = 200, name_ic?: string): Promise<NetboxManufacturer[]> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (name_ic) q.set("name_ic", name_ic);
  const data = await http<{ count: number; results: NetboxManufacturer[] }>(`/netbox/manufacturers?${q.toString()}`);
  return data?.results ?? [];
}

export async function fetchNetboxDeviceTypes(
  limit = 200,
  manufacturer?: string,
  model_ic?: string
): Promise<NetboxDeviceType[]> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (manufacturer) q.set("manufacturer", manufacturer);
  if (model_ic) q.set("model_ic", model_ic);
  const data = await http<{ count: number; results: NetboxDeviceType[] }>(`/netbox/device-types?${q.toString()}`);
  return data?.results ?? [];
}

export async function fetchNetboxDevicesBySite(site: string, limit = 200): Promise<NetboxDevice[]> {
  const q = new URLSearchParams({ site, limit: String(limit) });
  const data = await http<{ count: number; results: NetboxDevice[] }>(`/netbox/devices-by-site?${q.toString()}`);
  return data?.results ?? [];
}

export async function fetchNetboxChoices(): Promise<{
  interface_types: { value: string; label: string }[];
  rear_port_types: { value: string; label: string }[];
  front_port_types: { value: string; label: string }[];
}> {
  // pick the path your backend exposes; if unsure, try "/netbox/choices"
  return http("/netbox/choices");
}

/* =========================
   NetBox Writers
========================= */
export async function prepareNetboxDevice(body: {
  name: string;
  site: string;         // slug or name
  role: string;         // slug or name
  device_type: string;  // model or slug
  manufacturer?: string;
  status?: string;
  serial?: string;
  rack?: string;
  position?: number;
  face?: "front" | "rear";
}) {
  return http<{ ready_to_post: boolean; payload: Json; resolved: Json }>("/netbox/prepare-device", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function createNetboxDevice(body: Json) {
  return http("/netbox/create-device", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function createNetboxDeviceFromPayload(payload: Record<string, any>) {
  // backend accepts { payload } or full body (it calls prepare if payload missing)
  return createNetboxDevice({ payload });
}

export async function fetchNetboxDeviceWithPorts(
  device: string,
  site?: string
): Promise<{ device: any; interfaces: any[]; front_ports: any[]; rear_ports: any[] }> {
  const q = new URLSearchParams({ device });
  if (site) q.set("site", site);
  return http(`/netbox/device-with-ports?${q.toString()}`);
}

export async function createNetboxInterfaces(args: {
  device_id: number;
  interfaces: { name: string; type: string; description?: string }[];
}) {
  return http("/netbox/create-interfaces", { method: "POST", body: JSON.stringify(args) });
}

export async function createNetboxRearPorts(args: {
  device_id: number;
  rear_ports: { name: string; type: string; positions?: number; description?: string }[];
}) {
  return http("/netbox/create-rear-ports", { method: "POST", body: JSON.stringify(args) });
}

export async function createNetboxFrontPorts(args: {
  device_id: number;
  front_ports: {
    name: string;
    type: string;
    rear_port_id?: number;     // preferred
    rear_port?: string;        // or by name
    rear_port_position?: number;
    description?: string;
  }[];
}) {
  return http("/netbox/create-front-ports", { method: "POST", body: JSON.stringify(args) });
}

/** Bulk create interfaces for a device. */
export async function createInterfaces(device_id: number, interfaces: InterfaceInput[]) {
  return http("/netbox/create-interfaces", {
    method: "POST",
    body: JSON.stringify({ device_id, interfaces }),
  });
}

/** Bulk create rear ports for a device. */
export async function createRearPorts(device_id: number, rear_ports: RearPortInput[]) {
  return http("/netbox/create-rear-ports", {
    method: "POST",
    body: JSON.stringify({ device_id, rear_ports }),
  });
}

/** Bulk create front ports for a device. */
export async function createFrontPorts(device_id: number, front_ports: FrontPortInput[]) {
  return http("/netbox/create-front-ports", {
    method: "POST",
    body: JSON.stringify({ device_id, front_ports }),
  });
}

/* =========================
   Dev helper (window)
========================= */
export const api = {
  getCatalog,
  generate,

  fetchNetboxSites,
  fetchNetboxRoles,
  fetchNetboxManufacturers,
  fetchNetboxDeviceTypes,
  fetchNetboxDevicesBySite,
  fetchNetboxDeviceWithPorts,
  fetchNetboxChoices,

  prepareNetboxDevice,
  createNetboxDevice,
  createNetboxDeviceFromPayload,
  createInterfaces,
  createRearPorts,
  createFrontPorts,
};

declare global { interface Window { leonardoApi?: typeof api } }
// @ts-ignore
if (typeof window !== "undefined") window.leonardoApi = api;
