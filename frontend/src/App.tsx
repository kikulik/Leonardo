// frontend/src/App.tsx
import React, { useEffect, useRef, useState } from "react";
import { Canvas } from "./components/Canvas";
import AddEquipmentModal from "./components/AddEquipmentModal";

import {
  addDevice,
  copySelectedDevices,
  pasteDevices,
  deleteSelectedDevices,
  saveProject,
  withPortIds,
  type GraphState,
  type Device,
  type Port,
} from "./lib/editor";

import {
  fetchNetboxSites,
  fetchNetboxDevicesBySite,
  fetchNetboxRoles,
  fetchNetboxManufacturers,
  fetchNetboxDeviceTypes,
  fetchNetboxDeviceWithPorts,
  fetchNetboxChoices,
  prepareNetboxDevice,
  createNetboxDeviceFromPayload,
  createInterfaces,
  createRearPorts,
  createFrontPorts,
  type NetboxDevice,
  type NetboxSite,
  type NetboxRole,
  type NetboxManufacturer,
  type NetboxDeviceType,
  type InterfaceInput,
  type RearPortInput,
  type FrontPortInput,
} from "./lib/api";

type Mode = "select" | "pan" | "connect";

/** Local project storage key (single-project for now) */
const LS_KEY = "leonardo.graph.v1";

/* ===== Text tweaks persistence ===== */
const TWEAKS_LS_KEY = "leonardo.textTweaks.v1";
type TextTweaks = {
  portBasePx: number;
  portMinScale: number;
  portSensitivity: number;
  portMaxScale: number;
  portSelector: string;
  idBasePx: number;
  idMinScale: number;
  idSensitivity: number;
  idMaxScale: number;
  idOverlayThreshold: number;
  idOpacityFactor: number;
};
function loadTweaks(): TextTweaks | null {
  try {
    const raw = localStorage.getItem(TWEAKS_LS_KEY);
    return raw ? (JSON.parse(raw) as TextTweaks) : null;
  } catch {
    return null;
  }
}
function saveTweaks(t: TextTweaks) {
  try {
    localStorage.setItem(TWEAKS_LS_KEY, JSON.stringify(t));
  } catch {}
}

function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = (el.tagName || "").toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    (el as HTMLElement).isContentEditable === true
  );
}

function portDirectionFromText(name?: string, desc?: string): "IN" | "OUT" {
  const s = `${name || ""} ${desc || ""}`.toLowerCase();
  if (/\bin\b/.test(s) && /\bout\b/.test(s)) return "IN";
  return /\bin\b/.test(s) && !/\bout\b/.test(s) ? "IN" : "OUT";
}

function extractId(obj: any): number | undefined {
  if (!obj) return undefined;
  const cands: any[] = [obj?.id, obj?.device?.id, obj?.data?.id, obj?.result?.id, obj?.pk];
  for (const c of cands) {
    const n = typeof c === "string" ? parseInt(c, 10) : c;
    if (Number.isFinite(n) && n > 0) return n as number;
  }
  return undefined;
}

function mkUid() {
  // @ts-ignore
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

/* =========================================================
   Netbox Import Modal
========================================================= */
function NetboxImportModal({
  open,
  onClose,
  graph,
  setGraph,
}: {
  open: boolean;
  onClose: () => void;
  graph: GraphState;
  setGraph: (g: GraphState) => void;
}) {
  const [sites, setSites] = useState<NetboxSite[]>([]);
  const [site, setSite] = useState<string>("");
  const [devices, setDevices] = useState<NetboxDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) return;
    (async () => {
      const s = await fetchNetboxSites(200);
      setSites(s);
      if (s.length && !site) setSite(s[0].slug || s[0].name);
    })();
  }, [open]);

  useEffect(() => {
    if (!open || !site) return;
    setLoading(true);
    fetchNetboxDevicesBySite(site, 500)
      .then(setDevices)
      .finally(() => setLoading(false));
  }, [open, site]);

  const toggle = (id: number) => setChecked((c) => ({ ...c, [id]: !c[id] }));

  const filtered = devices.filter((d) => {
    if (!q.trim()) return true;
    const needle = q.trim().toLowerCase();
    const hay = `${d.name || ""} ${d.device_type?.model || ""} ${d.device_role?.name || ""}`.toLowerCase();
    return hay.includes(needle);
  });

  const importSelected = async () => {
    // existing device names to avoid duplicates
    const existing = new Set(graph.devices.map((d) => String(d.id)));
    let i = 0,
      x0 = 60,
      y0 = 60,
      dx = 260,
      dy = 160,
      perRow = 4;

    const toAdd: Device[] = [];

    for (const d of devices) {
      if (!checked[d.id]) continue;
      if (!d.name) continue;

      // auto-unique the name if needed
      let base = String(d.name);
      let name = base;
      let k = 2;
      while (existing.has(name)) name = `${base}-${k++}`;
      existing.add(name);

      const col = i % perRow;
      const row = Math.floor(i / perRow);
      i++;

      const type =
        d.device_role?.slug || (d as any).role?.slug || d.device_type?.model || "device";

      // Build the device shell first
      const dev: Device = {
        id: name,
        type,
        x: x0 + col * dx,
        y: y0 + row * dy,
        w: 200,
        h: 100,
        ports: [],
      };

      try {
        // Try to enrich with ports
        const full = await fetchNetboxDeviceWithPorts(String(d.id));

        const ports: Port[] = [];

        for (const iface of full.interfaces || []) {
          ports.push({
            id: mkUid(),
            name: iface.name,
            type: String(iface.type || "GEN").toUpperCase(),
            direction: portDirectionFromText(iface.name, iface.description),
          });
        }

        for (const rp of full.rear_ports || []) {
          ports.push({
            id: mkUid(),
            name: rp.name,
            type: String(rp.type || "GEN").toUpperCase(),
            direction: portDirectionFromText(rp.name, rp.description),
          });
        }

        for (const fp of full.front_ports || []) {
          ports.push({
            id: mkUid(),
            name: fp.name,
            type: String(fp.type || "GEN").toUpperCase(),
            direction: portDirectionFromText(fp.name, fp.description),
          });
        }

        dev.ports = ports;
      } catch (err) {
        console.warn("[Import] Ports fetch failed for", d.id, name, err);
        // Keep device shell with zero ports
      }

      toAdd.push(dev); // push regardless
    }

    setGraph((g) => ({ ...g, devices: [...g.devices, ...toAdd] }));
    onClose();
  };

  if (!open) return null;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(0,0,0,.55)",
        display: "grid",
        placeItems: "center",
      }}
    >
      <div
        style={{
          width: 640,
          background: "#0b1220",
          border: "1px solid #26324b",
          borderRadius: 12,
          padding: 16,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>NetBox Import</h3>
          <button onClick={onClose} style={{ background: "transparent", color: "#ccc" }}>✕</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "12rem 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: "#cbd5e1" }}>Site</label>
            <select
              value={site}
              onChange={(e) => setSite(e.target.value)}
              style={{
                display: "block",
                marginTop: 6,
                width: "100%",
                background: "#0f172a",
                color: "white",
                border: "1px solid #334155",
                borderRadius: 8,
                padding: "8px 10px",
              }}
            >
              {sites.map((s) => (
                <option key={s.id} value={s.slug || s.name}>
                  {s.name} {s.slug ? `(${s.slug})` : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: 12, color: "#cbd5e1" }}>Search</label>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter by name, model, role…"
              style={{
                display: "block",
                marginTop: 6,
                width: "100%",
                background: "#0f172a",
                color: "white",
                border: "1px solid #334155",
                borderRadius: 8,
                padding: "8px 10px",
              }}
            />
          </div>
        </div>

        <div style={{ borderTop: "1px solid #1f2a44", paddingTop: 10 }}>
          {loading ? (
            <div>Loading devices…</div>
          ) : filtered.length === 0 ? (
            <div>No devices match your filter.</div>
          ) : (
            <div className="space-y-1">
              {filtered.map((d) => (
                <label key={d.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!checked[d.id]}
                    onChange={() => toggle(d.id)}
                  />
                  <span className="text-slate-200">{d.name}</span>
                  <span className="text-slate-400">• {d.device_type?.model || ""}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button
            onClick={onClose}
            className="px-3 py-2 rounded"
            style={{ background: "#1f2937", border: "1px solid #334155" }}
          >
            Cancel
          </button>
          <button
            onClick={importSelected}
            className="px-3 py-2 rounded"
            style={{ background: "#16a34a", border: "1px solid #046a28" }}
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   Netbox Export Device Modal
========================================================= */
function NetboxExportDeviceModal({
  open,
  onClose,
  sourceDevice,
}: {
  open: boolean;
  onClose: () => void;
  sourceDevice: Device | null;
}) {
  const [name, setName] = useState(sourceDevice?.id?.toString()?.toLowerCase() || "");
  const [site, setSite] = useState("hq");
  const [role, setRole] = useState("core-switch");
  const [deviceType, setDeviceType] = useState("c9300-24t");
  const [manufacturer, setManufacturer] = useState("");
  const [serial, setSerial] = useState("");
  const [rack, setRack] = useState("");
  const [position, setPosition] = useState<number | "">("");
  const [face, setFace] = useState<"" | "front" | "rear">("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!sourceDevice) return;
    setSubmitting(true);
    try {
      const prep = await prepareNetboxDevice({
        name: (name || "").toLowerCase(),
        site: (site || "").toLowerCase(),
        role: (role || "").toLowerCase(),
        device_type: (deviceType || "").toLowerCase(),
        status: "active",
        manufacturer: manufacturer || undefined,
        serial: serial || undefined,
        rack: rack || undefined,
        position: position === "" ? undefined : Number(position),
        face: face || undefined,
      });

      const created = await createNetboxDeviceFromPayload(prep.payload as any);
      let deviceId = extractId(created);
      if (!deviceId) {
        const maybe = await fetchNetboxDeviceWithPorts(
          (name || "").toLowerCase(),
          (site || "").toLowerCase()
        );
        deviceId = extractId(maybe?.device) || extractId(maybe);
      }
      if (!deviceId) throw new Error("Device created but ID could not be resolved.");

      const d: any = sourceDevice;
      const rears: RearPortInput[] = (d.__nb_rear_ports || []) as RearPortInput[];
      const frontsRaw =
        (d.__nb_front_ports || []) as (FrontPortInput & { rear_port_name?: string })[];
      const ifaces: InterfaceInput[] = (d.__nb_interfaces || []) as InterfaceInput[];

      const rearMap = new Map<string, number>();
      if (rears.length) {
        await createRearPorts(deviceId, rears);
        const full = await fetchNetboxDeviceWithPorts(String(deviceId));
        (full.rear_ports || []).forEach((rp: any) => rearMap.set(rp.name, rp.id));
      }

      const fronts = frontsRaw.map((fp) => ({
        ...fp,
        rear_port_id: rearMap.get(String(fp.rear_port_name || ""))!,
      }));
      if (fronts.length) await createFrontPorts(deviceId, fronts);

      if (ifaces.length) await createInterfaces(deviceId, ifaces);

      onClose();
    } catch (e) {
      console.error(e);
      alert("Export failed. Check console for details.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.55)",
        display: "grid",
        placeItems: "center",
        zIndex: 60,
      }}
    >
      <div
        style={{
          width: 640,
          background: "#0b1220",
          border: "1px solid #26324b",
          borderRadius: 12,
          padding: 16,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Export Device to NetBox</h3>
          <button onClick={onClose} style={{ background: "transparent", color: "#ccc" }}>✕</button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            marginTop: 12,
          }}
        >
          <label>
            <div style={{ fontSize: 12, color: "#cbd5e1" }}>Name</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{
                width: "100%",
                marginTop: 6,
                background: "#0f172a",
                color: "white",
                border: "1px solid #334155",
                borderRadius: 8,
                padding: "8px 10px",
              }}
            />
          </label>
          <label>
            <div style={{ fontSize: 12, color: "#cbd5e1" }}>Site</div>
            <input
              value={site}
              onChange={(e) => setSite(e.target.value)}
              style={{
                width: "100%",
                marginTop: 6,
                background: "#0f172a",
                color: "white",
                border: "1px solid #334155",
                borderRadius: 8,
                padding: "8px 10px",
              }}
            />
          </label>
          <label>
            <div style={{ fontSize: 12, color: "#cbd5e1" }}>Role</div>
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              style={{
                width: "100%",
                marginTop: 6,
                background: "#0f172a",
                color: "white",
                border: "1px solid #334155",
                borderRadius: 8,
                padding: "8px 10px",
              }}
            />
          </label>
          <label>
            <div style={{ fontSize: 12, color: "#cbd5e1" }}>Device Type</div>
            <input
              value={deviceType}
              onChange={(e) => setDeviceType(e.target.value)}
              style={{
                width: "100%",
                marginTop: 6,
                background: "#0f172a",
                color: "white",
                border: "1px solid #334155",
                borderRadius: 8,
                padding: "8px 10px",
              }}
            />
          </label>
          <label>
            <div style={{ fontSize: 12, color: "#cbd5e1" }}>Manufacturer (optional)</div>
            <input
              value={manufacturer}
              onChange={(e) => setManufacturer(e.target.value)}
              style={{
                width: "100%",
                marginTop: 6,
                background: "#0f172a",
                color: "white",
                border: "1px solid #334155",
                borderRadius: 8,
                padding: "8px 10px",
              }}
            />
          </label>
          <label>
            <div style={{ fontSize: 12, color: "#cbd5e1" }}>Serial (optional)</div>
            <input
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              style={{
                width: "100%",
                marginTop: 6,
                background: "#0f172a",
                color: "white",
                border: "1px solid #334155",
                borderRadius: 8,
                padding: "8px 10px",
              }}
            />
          </label>
          <label>
            <div style={{ fontSize: 12, color: "#cbd5e1" }}>Rack (optional, name or id)</div>
            <input
              value={rack}
              onChange={(e) => setRack(e.target.value)}
              style={{
                width: "100%",
                marginTop: 6,
                background: "#0f172a",
                color: "white",
                border: "1px solid #334155",
                borderRadius: 8,
                padding: "8px 10px",
              }}
            />
          </label>
          <label>
            <div style={{ fontSize: 12, color: "#cbd5e1" }}>Position (U, optional)</div>
            <input
              type="number"
              value={position}
              onChange={(e) =>
                setPosition(e.target.value === "" ? "" : Number(e.target.value))
              }
              style={{
                width: "100%",
                marginTop: 6,
                background: "#0f172a",
                color: "white",
                border: "1px solid #334155",
                borderRadius: 8,
                padding: "8px 10px",
              }}
            />
          </label>
          <label>
            <div style={{ fontSize: 12, color: "#cbd5e1" }}>Face (optional)</div>
            <select
              value={face}
              onChange={(e) => setFace(e.target.value as any)}
              style={{
                width: "100%",
                marginTop: 6,
                background: "#0f172a",
                color: "white",
                border: "1px solid #334155",
                borderRadius: 8,
                padding: "8px 10px",
              }}
            >
              <option value="">— none —</option>
              <option value="front">front</option>
              <option value="rear">rear</option>
            </select>
          </label>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button
            onClick={onClose}
            className="px-3 py-2 rounded"
            style={{ background: "#1f2937", border: "1px solid #334155" }}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="px-3 py-2 rounded"
            style={{ background: "#2563eb", border: "1px solid #1d4ed8" }}
          >
            {submitting ? "Exporting…" : "Create Device + Ports"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   Netbox Export Ports Modal
========================================================= */
function NetboxExportPortsModal({
  open,
  onClose,
  sourceDevice,
}: {
  open: boolean;
  onClose: () => void;
  sourceDevice: Device | null;
}) {
  const [sites, setSites] = useState<NetboxSite[]>([]);
  const [site, setSite] = useState<string>("hq");
  const [devices, setDevices] = useState<NetboxDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const s = await fetchNetboxSites(200);
      setSites(s);
      if (s.length && !site) setSite(s[0].slug || s[0].name);
    })();
  }, [open]);

  useEffect(() => {
    if (!open || !site) return;
    setLoading(true);
    fetchNetboxDevicesBySite(site, 500)
      .then(setDevices)
      .finally(() => setLoading(false));
  }, [open, site]);

  const filtered = devices.filter((d) => {
    if (!q.trim()) return true;
    const needle = q.trim().toLowerCase();
    const hay = `${d.name || ""} ${d.device_type?.model || ""} ${d.device_role?.name || ""}`.toLowerCase();
    return hay.includes(needle);
  });

  const runExport = async () => {
    if (!sourceDevice) return alert("Select a device on the canvas first.");
    if (!selectedId) return alert("Choose a NetBox device to export ports to.");

    setSubmitting(true);
    try {
      const full = await fetchNetboxDeviceWithPorts(String(selectedId));
      const existingIf = new Set(
        (full.interfaces || []).map((p: any) => String(p.name).toLowerCase())
      );
      const existingRear = new Map<string, number>();
      (full.rear_ports || []).forEach((rp: any) =>
        existingRear.set(String(rp.name).toLowerCase(), rp.id)
      );
      const existingFront = new Set(
        (full.front_ports || []).map((p: any) => String(p.name).toLowerCase())
      );

      const d: any = sourceDevice;

      const rearsAll: RearPortInput[] = (d.__nb_rear_ports || []) as RearPortInput[];
      const rearsNew: RearPortInput[] = rearsAll.filter(
        (r) => !existingRear.has(String(r.name).toLowerCase())
      );
      if (rearsNew.length) {
        await createRearPorts(selectedId, rearsNew);
        const refreshed = await fetchNetboxDeviceWithPorts(String(selectedId));
        (refreshed.rear_ports || []).forEach((rp: any) =>
          existingRear.set(String(rp.name).toLowerCase(), rp.id)
        );
      }

      const frontsAll = (d.__nb_front_ports || []) as (FrontPortInput & {
        rear_port_name?: string;
      })[];
      const frontsNew = frontsAll.filter(
        (f) => !existingFront.has(String(f.name).toLowerCase())
      );
      if (frontsNew.length) {
        const mapped = frontsNew.map((fp) => ({
          ...fp,
          rear_port_id: existingRear.get(String(fp.rear_port_name || "").toLowerCase()),
        }));
        await createFrontPorts(selectedId, mapped as any);
      }

      const ifacesAll: InterfaceInput[] = (d.__nb_interfaces || []) as InterfaceInput[];
      const ifacesNew = ifacesAll.filter(
        (i) => !existingIf.has(String(i.name).toLowerCase())
      );
      if (ifacesNew.length) await createInterfaces(selectedId, ifacesNew);

      onClose();
    } catch (e) {
      console.error(e);
      alert("Export failed. Check console for details.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.55)",
        display: "grid",
        placeItems: "center",
        zIndex: 60,
      }}
    >
      <div
        style={{
          width: 640,
          background: "#0b1220",
          border: "1px solid #26324b",
          borderRadius: 12,
          padding: 16,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Export Ports to NetBox</h3>
          <button onClick={onClose} style={{ background: "transparent", color: "#ccc" }}>✕</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: "#cbd5e1" }}>Site</label>
            <select
              value={site}
              onChange={(e) => setSite(e.target.value)}
              style={{
                display: "block",
                marginTop: 6,
                width: "100%",
                background: "#0f172a",
                color: "white",
                border: "1px solid #334155",
                borderRadius: 8,
                padding: "8px 10px",
              }}
            >
              {sites.map((s) => (
                <option key={s.id} value={s.slug || s.name}>
                  {s.name} {s.slug ? `(${s.slug})` : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: 12, color: "#cbd5e1" }}>Search device</label>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter by name, model, role…"
              style={{
                display: "block",
                marginTop: 6,
                width: "100%",
                background: "#0f172a",
                color: "white",
                border: "1px solid #334155",
                borderRadius: 8,
                padding: "8px 10px",
              }}
            />
          </div>
        </div>

        <div style={{ borderTop: "1px solid #1f2a44", paddingTop: 10 }}>
          {loading ? (
            <div>Loading devices…</div>
          ) : filtered.length === 0 ? (
            <div>No devices match your filter.</div>
          ) : (
            <div className="space-y-1">
              {filtered.map((d) => (
                <label key={d.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="nb-target"
                    checked={selectedId === d.id}
                    onChange={() => setSelectedId(d.id)}
                  />
                  <span className="text-slate-200">{d.name}</span>
                  <span className="text-slate-400">• {d.device_type?.model || ""}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button
            onClick={onClose}
            className="px-3 py-2 rounded"
            style={{ background: "#1f2937", border: "1px solid #334155" }}
          >
            Cancel
          </button>
          <button
            onClick={runExport}
            disabled={submitting}
            className="px-3 py-2 rounded"
            style={{ background: "#16a34a", border: "1px solid #046a28" }}
          >
            {submitting ? "Exporting…" : "Export New Ports"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   NB Port Modal
========================================================= */
type PortKind = "interface" | "rear" | "front";
type NBChoices = {
  interface_types: { value: string; label: string }[];
  rear_port_types: { value: string; label: string }[];
  front_port_types: { value: string; label: string }[];
};

function NBPortModal({
  open,
  onClose,
  kind,
  onCreate,
  choices,
  rearOptions,
}: {
  open: boolean;
  onClose: () => void;
  kind: PortKind;
  onCreate: (payload: InterfaceInput | RearPortInput | (FrontPortInput & { rear_port_name?: string }) | any) => void;
  choices: NBChoices;
  rearOptions: { id: number; name: string; positions: number }[];
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [positions, setPositions] = useState<number>(1);
  const [rearPseudoId, setRearPseudoId] = useState<number>(rearOptions[0]?.id || 0);
  const [rearPos, setRearPos] = useState<number>(1);
  const [direction, setDirection] = useState<"in" | "out" | "io">("in");
  const [desc, setDesc] = useState("");

  useEffect(() => {
    if (!open) return;
    setName("");
    setType("");
    setPositions(1);
    setRearPseudoId(rearOptions[0]?.id || 0);
    setRearPos(1);
    setDirection("in");
    setDesc("");
  }, [open, kind, rearOptions]);

  const submit = () => {
    const description = desc;
    const __direction = direction === "io" ? "in" : direction;

    if (kind === "interface") {
      if (!name || !type) return alert("Name and type are required.");
      onCreate({ name: name.trim(), type: type.trim(), description, __direction });
    } else if (kind === "rear") {
      if (!name || !type || !positions) return alert("Name, type, positions are required.");
      onCreate({ name: name.trim(), type: type.trim(), positions, description, __direction });
    } else {
      if (!name || !type || !rearPseudoId || !rearPos)
        return alert("Name, type, rear port and position are required.");
      const rear = rearOptions.find((r) => r.id === rearPseudoId);
      onCreate({
        name: name.trim(),
        type: type.trim(),
        rear_port_id: rearPseudoId as any,
        rear_port_name: rear?.name || "",
        rear_port_position: rearPos,
        description,
        __direction,
      } as any);
    }
    onClose();
  };

  if (!open) return null;
  const typeChoices =
    kind === "interface"
      ? choices.interface_types
      : kind === "rear"
      ? choices.rear_port_types
      : choices.front_port_types;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.55)",
        display: "grid",
        placeItems: "center",
        zIndex: 60,
      }}
    >
      <div
        style={{
          width: 560,
          background: "#0b1220",
          border: "1px solid #26324b",
          borderRadius: 12,
          padding: 16,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>
            Add NetBox {kind === "interface" ? "Interface" : kind === "rear" ? "Rear Port" : "Front Port"}
          </h3>
          <button onClick={onClose} style={{ background: "transparent", color: "#ccc" }}>✕</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
          <label>
            <div className="text-xs text-slate-400">Name</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1"
            />
          </label>

          <label>
            <div className="text-xs text-slate-400">Type</div>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1"
            >
              <option value="">— select —</option>
              {typeChoices.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <div className="text-xs text-slate-400">Direction (visual)</div>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value as any)}
              className="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1"
            >
              <option value="in">in (left)</option>
              <option value="out">out (right)</option>
              <option value="io">in/out</option>
            </select>
          </label>

          <label style={{ gridColumn: "1 / -1" }}>
            <div className="text-xs text-slate-400">Description (optional)</div>
            <input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              className="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1"
              placeholder="Optional"
            />
          </label>

          {kind === "rear" && (
            <label>
              <div className="text-xs text-slate-400">Positions</div>
              <input
                type="number"
                min={1}
                value={positions}
                onChange={(e) => setPositions(Math.max(1, Number(e.target.value || 1)))}
                className="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1"
              />
            </label>
          )}

          {kind === "front" && (
            <>
              <label>
                <div className="text-xs text-slate-400">Rear Port</div>
                <select
                  value={rearPseudoId}
                  onChange={(e) => setRearPseudoId(Number(e.target.value))}
                  className="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1"
                >
                  {rearOptions.map((rp) => (
                    <option key={rp.id} value={rp.id}>
                      {rp.name} (x{rp.positions})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <div className="text-xs text-slate-400">Rear Port Position</div>
                <input
                  type="number"
                  min={1}
                  value={rearPos}
                  onChange={(e) => setRearPos(Math.max(1, Number(e.target.value || 1)))}
                  className="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1"
                />
              </label>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-3 py-2 rounded"
            style={{ background: "#1f2937", border: "1px solid #334155" }}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            className="px-3 py-2 rounded"
            style={{ background: "#16a34a", border: "1px solid #046a28" }}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   App
========================================================= */
export default function App() {
  const [graph, setGraph] = useState<GraphState>({ devices: [], connections: [] });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [showRightPanel, setShowRightPanel] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [mode, setMode] = useState<Mode>("select");

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const [clipboard, setClipboard] = useState<Device[]>([]);
  const undoStack = useRef<GraphState[]>([]);
  const redoStack = useRef<GraphState[]>([]);

  const [aiPrompt, setAiPrompt] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportDeviceOpen, setExportDeviceOpen] = useState(false);
  const [exportPortsOpen, setExportPortsOpen] = useState(false);

  // NB port modal
  const [portModalOpen, setPortModalOpen] = useState(false);
  const [portKind, setPortKind] = useState<"interface" | "rear" | "front">("interface");
  const [nbChoices, setNbChoices] = useState<{
    interface_types: { value: string; label: string }[];
    rear_port_types: { value: string; label: string }[];
    front_port_types: { value: string; label: string }[];
  }>({ interface_types: [], front_port_types: [], rear_port_types: [] });

  /* === UI-tweakable text parameters (with persistence) === */
  // Ports (UI)
  const [portBasePx, setPortBasePx] = useState<number>(12);
  const [portMinScale, setPortMinScale] = useState<number>(1);
  const [portSensitivity, setPortSensitivity] = useState<number>(0.9);
  const [portMaxScale, setPortMaxScale] = useState<number>(2.25);
  const [portSelector, setPortSelector] = useState<string>(
    '.port-label, .port-name, [data-role="port-label"], [data-port-label="true"], svg text.port-label, svg [data-port-label="true"]'
  );
  const [portMatchCount, setPortMatchCount] = useState<number>(0);

  // Device ID overlay
  const [idBasePx, setIdBasePx] = useState<number>(12);
  const [idMinScale, setIdMinScale] = useState<number>(1);
  const [idSensitivity, setIdSensitivity] = useState<number>(0.9);
  const [idMaxScale, setIdMaxScale] = useState<number>(2.25);
  const [idOverlayThreshold, setIdOverlayThreshold] = useState<number>(0.95);
  const [idOpacityFactor, setIdOpacityFactor] = useState<number>(2);

  // persist selection for any legacy helpers
  useEffect(() => {
    (window as any)._leonardoSelectedIds = new Set(selectedIds);
  }, [selectedIds]);

  // load graph from localStorage
  useEffect(() => {
    try {
      const txt = localStorage.getItem(LS_KEY);
      if (txt) setGraph(withPortIds(JSON.parse(txt)));
    } catch {}
  }, []);

  // load saved text tweaks on mount
  useEffect(() => {
    const t = loadTweaks();
    if (!t) return;
    setPortBasePx(t.portBasePx);
    setPortMinScale(t.portMinScale);
    setPortSensitivity(t.portSensitivity);
    setPortMaxScale(t.portMaxScale);
    setPortSelector(t.portSelector || portSelector);
    setIdBasePx(t.idBasePx);
    setIdMinScale(t.idMinScale);
    setIdSensitivity(t.idSensitivity);
    setIdMaxScale(t.idMaxScale);
    setIdOverlayThreshold(t.idOverlayThreshold);
    setIdOpacityFactor(t.idOpacityFactor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // autosave graph
  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(graph));
      } catch {}
    }, 250);
    return () => clearTimeout(id);
  }, [graph]);

  const pushHistory = (state: GraphState) => {
    undoStack.current.push(state);
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
  };
  const updateGraph = (next: GraphState) =>
    setGraph((prev) => {
      pushHistory(prev);
      return next;
    });
  const onCanvasChange = (next: GraphState) => updateGraph(next);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (undoStack.current.length) {
          const prev = undoStack.current.pop()!;
          redoStack.current.push(graph);
          setGraph(prev);
          setSelectedIds(new Set());
        }
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))
      ) {
        e.preventDefault();
        if (redoStack.current.length) {
          const nxt = redoStack.current.pop()!;
          undoStack.current.push(graph);
          setGraph(nxt);
          setSelectedIds(new Set());
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        e.preventDefault();
        setClipboard(copySelectedDevices(graph, selectedIds));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        e.preventDefault();
        if (!clipboard.length) return;
        updateGraph(pasteDevices(graph, clipboard));
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedIds.size) {
          e.preventDefault();
          updateGraph(deleteSelectedDevices(graph, selectedIds));
          setSelectedIds(new Set());
        }
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true } as any);
  }, [graph, selectedIds, clipboard]);

  const handleSaveFile = () => saveProject(graph, "project.json");

  const handleAddSubmit = (p: {
    type: string;
    quantity: number;
    customNameBase?: string;
    manufacturer?: string;
    model?: string;
    w?: number;
    h?: number;
    color?: string;
    inPorts?: { type: string; quantity: number };
    outPorts?: { type: string; quantity: number };
  }) => {
    const defaults: Partial<Port>[] = [];
    const addPorts = (direction: "IN" | "OUT", t?: string, qty?: number) => {
      const n = Math.max(0, qty || 0);
      for (let i = 1; i <= n; i++) {
        defaults.push({
          name: `${(t || "PORT").toUpperCase()}_${direction}_${i}`,
          type: (t || "GEN").toUpperCase(),
          direction,
        });
      }
    };
    addPorts("IN", p.inPorts?.type, p.inPorts?.quantity);
    addPorts("OUT", p.outPorts?.type, p.outPorts?.quantity);

    updateGraph(
      addDevice(graph, {
        type: p.type,
        count: p.quantity || 1,
        customNameBase: p.customNameBase,
        w: p.w || 160,
        h: p.h || 80,
        color: p.color || "#334155",
        manufacturer: p.manufacturer,
        model: p.model,
        defaultPorts: defaults,
      })
    );
    setAddOpen(false);
  };

  const getSelectedDevice = (): [Device | undefined, number] => {
    const id = Array.from(selectedIds)[0];
    const idx = graph.devices.findIndex((d) => d.id === id);
    return [idx >= 0 ? graph.devices[idx] : undefined, idx];
  };
  const ensureNBFields = (d: Device) => {
    if (!(d as any).__nb_interfaces) (d as any).__nb_interfaces = [] as InterfaceInput[];
    if (!(d as any).__nb_rear_ports) (d as any).__nb_rear_ports = [] as RearPortInput[];
    if (!(d as any).__nb_front_ports) (d as any).__nb_front_ports = [] as FrontPortInput[];
  };

  const openAddNBPort = async (kind: "interface" | "rear" | "front") => {
    try {
      const ch = await fetchNetboxChoices();
      setNbChoices(ch);
    } catch {
      setNbChoices({ interface_types: [], front_port_types: [], rear_port_types: [] });
    }
    setPortKind(kind);
    setPortModalOpen(true);
  };

  const addNBPort = (payload: any) => {
    setGraph((g) => {
      const selId = Array.from(selectedIds)[0];
      const idx = g.devices.findIndex((d) => d.id === selId);
      if (idx < 0) return g;
      const copy: any = { ...g.devices[idx] };
      ensureNBFields(copy);

      if ("rear_port_position" in payload) {
        copy.__nb_front_ports = [...copy.__nb_front_ports, payload as any];
      } else if ("positions" in payload) {
        copy.__nb_rear_ports = [...copy.__nb_rear_ports, payload as RearPortInput];
      } else {
        copy.__nb_interfaces = [...copy.__nb_interfaces, payload as InterfaceInput];
      }

      const vName = (payload as any).name || "PORT";
      const vType = String((payload as any).type || "GEN").toUpperCase();
      const vDesc = (payload as any).description || "";
      const vDir: "IN" | "OUT" =
        payload &&
        typeof payload.__direction === "string" &&
        payload.__direction.toLowerCase().startsWith("out")
          ? "OUT"
          : payload && typeof payload.__direction === "string"
          ? "IN"
          : portDirectionFromText(vName, vDesc);

      copy.ports = [
        ...(copy.ports || []),
        { id: mkUid(), name: vName, type: vType, direction: vDir },
      ];

      const devices = g.devices.slice();
      devices[idx] = copy;
      return { ...g, devices };
    });
  };

  function directionForClone(copy: any, last: any): "IN" | "OUT" {
    if (typeof last?.__direction === "string") {
      return last.__direction.toLowerCase().startsWith("out") ? "OUT" : "IN";
    }
    const vis = (copy.ports || [])
      .slice()
      .reverse()
      .find((p: any) => p?.name === last?.name);
    if (vis?.direction === "IN" || vis?.direction === "OUT") return vis.direction;
    return portDirectionFromText(last?.name, last?.description);
  }

  const cloneLastNBPort = (kind: "interface" | "rear" | "front") => {
    setGraph((g) => {
      const selId = Array.from(selectedIds)[0];
      const idx = g.devices.findIndex((d) => d.id === selId);
      if (idx < 0) return g;
      const copy: any = { ...g.devices[idx] };
      ensureNBFields(copy);

      const bump = (name: string) => {
        const m = name.match(/^(.*?)(\d+)\s*$/);
        if (!m) return `${name} 2`;
        const base = m[1].trim();
        const n = parseInt(m[2], 10);
        return `${base} ${n + 1}`;
      };

      const addVisual = (
        name: string,
        type: string,
        description?: string,
        forcedDir?: "IN" | "OUT"
      ) => {
        const dir: "IN" | "OUT" = forcedDir || portDirectionFromText(name, description);
        copy.ports = [
          ...(copy.ports || []),
          {
            id: mkUid(),
            name,
            type: String(type || "GEN").toUpperCase(),
            direction: dir,
          },
        ];
      };

      if (kind === "interface") {
        const arr = copy.__nb_interfaces as any[];
        if (!arr.length) return g;
        const last = arr[arr.length - 1];
        const next: any = { ...last, name: bump(last.name) };
        const dir = directionForClone(copy, last);
        next.__direction = dir === "OUT" ? "out" : "in";
        copy.__nb_interfaces = [...arr, next];
        addVisual(next.name, next.type, next.description, dir);
      } else if (kind === "rear") {
        const arr = copy.__nb_rear_ports as any[];
        if (!arr.length) return g;
        const last = arr[arr.length - 1];
        const next: any = { ...last, name: bump(last.name) };
        const dir = directionForClone(copy, last);
        next.__direction = dir === "OUT" ? "out" : "in";
        copy.__nb_rear_ports = [...arr, next];
        addVisual(next.name, next.type, next.description, dir);
      } else {
        const arr = copy.__nb_front_ports as any[];
        if (!arr.length) return g;
        const last = arr[arr.length - 1];
        const next: any = { ...last, name: bump(last.name) };
        const dir = directionForClone(copy, last);
        next.__direction = dir === "OUT" ? "out" : "in";
        copy.__nb_front_ports = [...arr, next];
        addVisual(next.name, next.type, next.description, dir);
      }

      const devices = g.devices.slice();
      devices[idx] = copy;
      return { ...g, devices };
    });
  };

  /* === Scales === */
  const idScale = Math.min(
    idMaxScale,
    Math.max(idMinScale, (1 / Math.max(zoom, 0.001)) * idSensitivity)
  );
  const portScale = Math.min(
    portMaxScale,
    Math.max(portMinScale, (1 / Math.max(zoom, 0.001)) * portSensitivity)
  );
  const showIdOverlay = zoom < idOverlayThreshold;
  const idOpacity = Math.min(1, Math.max(0, (1 - zoom) * idOpacityFactor));

  /* === Apply / Reset for text tweaks === */
  const applyTweaks = () => {
    saveTweaks({
      portBasePx,
      portMinScale,
      portSensitivity,
      portMaxScale,
      portSelector,
      idBasePx,
      idMinScale,
      idSensitivity,
      idMaxScale,
      idOverlayThreshold,
      idOpacityFactor,
    });
    console.log("[Text Tweaks] Saved.");
  };
  const resetTweaks = () => {
    const defaults: TextTweaks = {
      portBasePx: 12,
      portMinScale: 1,
      portSensitivity: 0.9,
      portMaxScale: 2.25,
      portSelector:
        '.port-label, .port-name, [data-role="port-label"], [data-port-label="true"], svg text.port-label, svg [data-port-label="true"]',
      idBasePx: 12,
      idMinScale: 1,
      idSensitivity: 0.9,
      idMaxScale: 2.25,
      idOverlayThreshold: 0.95,
      idOpacityFactor: 2,
    };
    setPortBasePx(defaults.portBasePx);
    setPortMinScale(defaults.portMinScale);
    setPortSensitivity(defaults.portSensitivity);
    setPortMaxScale(defaults.portMaxScale);
    setPortSelector(defaults.portSelector);
    setIdBasePx(defaults.idBasePx);
    setIdMinScale(defaults.idMinScale);
    setIdSensitivity(defaults.idSensitivity);
    setIdMaxScale(defaults.idMaxScale);
    setIdOverlayThreshold(defaults.idOverlayThreshold);
    setIdOpacityFactor(defaults.idOpacityFactor);
    saveTweaks(defaults);
  };

  /* === Live match counter (for DOM labels only) === */
  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        const n = document.querySelectorAll(portSelector).length;
        setPortMatchCount(n);
      } catch {
        setPortMatchCount(0);
      }
    }, 50);
    return () => clearTimeout(id);
  }, [portSelector, zoom, graph]);

  return (
    <div
      className="min-h-screen flex flex-col text-white zoom-scope"
      style={
        {
          "--z": zoom,
          "--portBasePx": `${portBasePx}px`,
          "--portMinScale": portMinScale,
          "--portSensitivity": portSensitivity,
          "--portMaxScale": portMaxScale,
          background:
            "linear-gradient(135deg, rgb(15,23,42) 0%, rgb(30,41,59) 100%)",
        } as React.CSSProperties
      }
    >
      {/* DOM-only label scaling — canvas text is handled via props on <Canvas /> */}
      <style>{`
        ${portSelector} {
          --portScale: clamp(var(--portMinScale), calc((1 / var(--z)) * var(--portSensitivity)), var(--portMaxScale));
          font-size: calc(var(--portBasePx) * var(--portScale));
          line-height: 1.05;
          white-space: nowrap;
          transform-origin: left center;
        }
      `}</style>

      {/* Top */}
      <header className="h-14 shrink-0 border-b border-slate-700/60 px-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 grid place-items-center font-bold">
            L
          </div>
          <div className="font-semibold tracking-wide">Leonardo</div>
          <div className="ml-3 px-2 py-0.5 text-xs rounded bg-slate-800/70 border border-slate-700">
            Broadcast Schematic Editor
          </div>
        </div>
        <div className="text-xs text-slate-300">v0.9 • autosave</div>
      </header>

      {/* Body */}
      <div className="flex-1 min-h-0 grid grid-cols-[18rem,1fr,22rem]">
        {/* Left tools */}
        <aside className="border-r border-slate-700/60 p-4 overflow-y-auto">
          <h3 className="text-sm font-semibold text-slate-200 mb-3">Equipment</h3>
          <button
            className="w-full mb-3 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-medium"
            onClick={() => setAddOpen(true)}
          >
            + Add Equipment
          </button>

          <div className="grid grid-cols-3 gap-2">
            <button
              className="bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded-lg text-sm"
              onClick={() => setClipboard(copySelectedDevices(graph, selectedIds))}
              disabled={!selectedIds.size}
            >
              Copy
            </button>
            <button
              className="bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded-lg text-sm"
              onClick={() => clipboard.length && updateGraph(pasteDevices(graph, clipboard))}
              disabled={!clipboard.length}
            >
              Paste
            </button>
            <button
              className="bg-red-600 hover:bg-red-700 px-3 py-2 rounded-lg text-sm"
              onClick={() => {
                if (!selectedIds.size) return;
                updateGraph(deleteSelectedDevices(graph, selectedIds));
                setSelectedIds(new Set());
              }}
              disabled={!selectedIds.size}
            >
              Delete
            </button>
          </div>

          {/* NetBox actions */}
          <div className="space-y-2 mt-4">
            <button
              onClick={() => setImportOpen(true)}
              className="w-full px-4 py-2 rounded-lg font-medium"
              style={{ background: "#16a34a" }}
            >
              NetBox Import
            </button>

            <button
              onClick={() => {
                const first = Array.from(selectedIds)[0];
                if (!first) return alert("Select one device on the canvas to export.");
                setExportDeviceOpen(true);
              }}
              className="w-full px-4 py-2 rounded-lg font-medium bg-slate-700 hover:bg-slate-600"
            >
              Export Device
            </button>

            <button
              onClick={() => {
                const first = Array.from(selectedIds)[0];
                if (!first)
                  return alert("Select one device on the canvas to export its ports.");
                setExportPortsOpen(true);
              }}
              className="w-full px-4 py-2 rounded-lg font-medium bg-blue-600 hover:bg-blue-700"
              disabled={!selectedIds.size}
            >
              Export Ports
            </button>

            {/* Add NB ports */}
            <div className="grid grid-cols-2 gap-2">
              <button
                className="px-3 py-2 rounded bg-slate-700 hover:bg-slate-600 text-sm"
                onClick={() => openAddNBPort("interface")}
                disabled={!selectedIds.size}
              >
                + NB Interface
              </button>
              <button
                className="px-3 py-2 rounded bg-slate-700 hover:bg-slate-600 text-sm"
                onClick={() => cloneLastNBPort("interface")}
                disabled={!selectedIds.size}
              >
                Clone Interface
              </button>
              <button
                className="px-3 py-2 rounded bg-slate-700 hover:bg-slate-600 text-sm"
                onClick={() => openAddNBPort("rear")}
                disabled={!selectedIds.size}
              >
                + NB Rear
              </button>
              <button
                className="px-3 py-2 rounded bg-slate-700 hover:bg-slate-600 text-sm"
                onClick={() => cloneLastNBPort("rear")}
                disabled={!selectedIds.size}
              >
                Clone Rear
              </button>
              <button
                className="px-3 py-2 rounded bg-slate-700 hover:bg-slate-600 text-sm"
                onClick={() => openAddNBPort("front")}
                disabled={!selectedIds.size}
              >
                + NB Front
              </button>
              <button
                className="px-3 py-2 rounded bg-slate-700 hover:bg-slate-600 text-sm"
                onClick={() => cloneLastNBPort("front")}
                disabled={!selectedIds.size}
              >
                Clone Front
              </button>
            </div>
          </div>
        </aside>

        {/* Canvas + device ID overlay */}
        <main className="p-4 overflow-hidden flex flex-col">
          <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
            <Canvas
              graph={graph}
              selectedIds={selectedIds}
              mode={mode}
              onToggleSelect={(id, add) => {
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  if (add) {
                    next.has(id) ? next.delete(id) : next.add(id);
                  } else {
                    next.clear();
                    next.add(id);
                  }
                  return next;
                });
              }}
              onClearSelection={() => setSelectedIds(new Set())}
              onChange={(next) => onCanvasChange(next)}
              showGrid={showGrid}
              zoom={zoom}
              pan={pan}
              onViewChange={(v) => {
                if (v.zoom !== undefined) setZoom(v.zoom);
                if (v.pan !== undefined) setPan(v.pan);
              }}
              snapEnabled={snapEnabled}

              /* Port label font from UI (used by Canvas when ctx.font is set) */
              portLabelBasePx={portBasePx}
              portLabelScale={portScale}
            />

            {/* Device-ID overlay */}
            {showIdOverlay && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  pointerEvents: "none",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: "top left",
                    opacity: idOpacity,
                  }}
                >
                  {graph.devices.map((d) => {
                    const labelFontPx = idBasePx * idScale;
                    const left = (d.x ?? 0) + (d.w ?? 160) / 2;
                    const top = (d.y ?? 0) + 6;
                    return (
                      <div
                        key={`idlabel-${d.id}`}
                        style={{
                          position: "absolute",
                          left,
                          top,
                          transform: "translate(-50%, 0)",
                          fontSize: `${labelFontPx}px`,
                          lineHeight: 1.05,
                          fontWeight: 700,
                          color: "rgba(255,255,255,0.95)",
                          textShadow: "0 1px 2px rgba(0,0,0,0.7)",
                          whiteSpace: "nowrap",
                          padding: "1px 6px",
                          borderRadius: 6,
                          background: "rgba(2,6,23,0.45)",
                          border: "1px solid rgba(51,65,85,0.45)",
                        }}
                        title={String(d.id)}
                      >
                        {String(d.id)}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </main>

        {/* Properties */}
        <aside className="border-l border-slate-700/60 p-4 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-200">Properties</h3>
            <button
              onClick={() => setShowRightPanel((v) => !v)}
              className="text-slate-300 hover:text-white text-sm"
            >
              {showRightPanel ? "Hide" : "Show"}
            </button>
          </div>

          {showRightPanel && (
            <div className="space-y-3">
              {/* Text Size Tweaks */}
              <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-3">
                <div className="text-xs font-semibold text-slate-300 mb-2">Text Size Tweaks</div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  {/* Ports */}
                  <div className="col-span-2 text-slate-400 font-medium mt-1">Ports</div>
                  <label className="flex flex-col">
                    <span className="text-slate-400">Base (px)</span>
                    <input
                      type="number"
                      min={8}
                      step={1}
                      value={portBasePx}
                      onChange={(e) => setPortBasePx(Number(e.target.value || 0))}
                      className="mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1"
                    />
                  </label>
                  <label className="flex flex-col">
                    <span className="text-slate-400">Min scale</span>
                    <input
                      type="number"
                      min={0.5}
                      step={0.05}
                      value={portMinScale}
                      onChange={(e) => setPortMinScale(Number(e.target.value || 0))}
                      className="mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1"
                    />
                  </label>
                  <label className="flex flex-col">
                    <span className="text-slate-400">Sensitivity</span>
                    <input
                      type="number"
                      min={0.1}
                      step={0.05}
                      value={portSensitivity}
                      onChange={(e) => setPortSensitivity(Number(e.target.value || 0))}
                      className="mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1"
                    />
                  </label>
                  <label className="flex flex-col">
                    <span className="text-slate-400">Max scale</span>
                    <input
                      type="number"
                      min={1}
                      step={0.25}
                      value={portMaxScale}
                      onChange={(e) => setPortMaxScale(Number(e.target.value || 0))}
                      className="mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1"
                    />
                  </label>

                  {/* Port selector hints (DOM) */}
                  <label className="flex flex-col col-span-2">
                    <span className="text-slate-400">Port label selector (CSS)</span>
                    <input
                      value={portSelector}
                      onChange={(e) => setPortSelector(e.target.value)}
                      placeholder=".port-label, svg text.port-label, [data-port-label='true']"
                      className="mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1"
                    />
                    <span className="mt-1 text-[11px] text-slate-400">
                      Matches now: <strong>{portMatchCount}</strong>
                    </span>
                  </label>

                  {/* Device IDs */}
                  <div className="col-span-2 text-slate-400 font-medium mt-3">Device IDs</div>
                  <label className="flex flex-col">
                    <span className="text-slate-400">Base (px)</span>
                    <input
                      type="number"
                      min={8}
                      step={1}
                      value={idBasePx}
                      onChange={(e) => setIdBasePx(Number(e.target.value || 0))}
                      className="mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1"
                    />
                  </label>
                  <label className="flex flex-col">
                    <span className="text-slate-400">Min scale</span>
                    <input
                      type="number"
                      min={0.5}
                      step={0.05}
                      value={idMinScale}
                      onChange={(e) => setIdMinScale(Number(e.target.value || 0))}
                      className="mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1"
                    />
                  </label>
                  <label className="flex flex-col">
                    <span className="text-slate-400">Sensitivity</span>
                    <input
                      type="number"
                      min={0.1}
                      step={0.05}
                      value={idSensitivity}
                      onChange={(e) => setIdSensitivity(Number(e.target.value || 0))}
                      className="mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1"
                    />
                  </label>
                  <label className="flex flex-col">
                    <span className="text-slate-400">Max scale</span>
                    <input
                      type="number"
                      min={1}
                      step={0.25}
                      value={idMaxScale}
                      onChange={(e) => setIdMaxScale(Number(e.target.value || 0))}
                      className="mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1"
                    />
                  </label>
                  <label className="flex flex-col">
                    <span className="text-slate-400">Show below zoom</span>
                    <input
                      type="number"
                      min={0.1}
                      max={3}
                      step={0.05}
                      value={idOverlayThreshold}
                      onChange={(e) => setIdOverlayThreshold(Number(e.target.value || 0))}
                      className="mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1"
                    />
                  </label>
                  <label className="flex flex-col">
                    <span className="text-slate-400">Fade strength</span>
                    <input
                      type="number"
                      min={0.1}
                      step={0.1}
                      value={idOpacityFactor}
                      onChange={(e) => setIdOpacityFactor(Number(e.target.value || 0))}
                      className="mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1"
                    />
                  </label>
                </div>

                <div className="flex gap-2 mt-3">
                  <button
                    onClick={applyTweaks}
                    className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-xs"
                  >
                    Apply (save)
                  </button>
                  <button
                    onClick={resetTweaks}
                    className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-xs"
                  >
                    Reset to defaults
                  </button>
                </div>
              </div>

              {selectedIds.size === 0 ? (
                <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-3 text-slate-400 text-sm">
                  Nothing selected. Ctrl/Cmd-click to multi-select. Use the Connect tool to link ports.
                </div>
              ) : (
                Array.from(selectedIds).map((id) => {
                  const d = graph.devices.find((x) => x.id === id)!;
                  const update = (patch: Partial<Device>) =>
                    setGraph((g) => ({
                      ...g,
                      devices: g.devices.map((x) =>
                        x.id === id ? { ...x, ...patch } : x
                      ),
                    }));

                  const nbIf = (d as any).__nb_interfaces as InterfaceInput[] | undefined;
                  const nbRear = (d as any).__nb_rear_ports as RearPortInput[] | undefined;
                  const nbFront = (d as any).__nb_front_ports as FrontPortInput[] | undefined;

                  return (
                    <div key={id} className="rounded-xl border border-slate-700 bg-slate-800/40 p-3 space-y-2">
                      <div className="text-slate-300 text-sm mb-1">{d.id}</div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-slate-400">Type</label>
                          <input
                            className="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1"
                            value={d.type ?? ""}
                            onChange={(e) => update({ type: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400">Color</label>
                          <input
                            type="color"
                            className="w-full h-9 mt-1 bg-slate-800 border border-slate-700 rounded"
                            value={d.color || "#334155"}
                            onChange={(e) => update({ color: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400">Manufacturer</label>
                          <input
                            className="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1"
                            value={(d as any).manufacturer ?? ""}
                            onChange={(e) => update({ manufacturer: e.target.value } as any)}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400">Model</label>
                          <input
                            className="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1"
                            value={(d as any).model ?? ""}
                            onChange={(e) => update({ model: e.target.value } as any)}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400">Width (body)</label>
                          <input
                            type="number"
                            min={80}
                            className="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1"
                            value={d.w ?? 160}
                            onChange={(e) =>
                              update({ w: parseInt(e.target.value || "160", 10) as any })
                            }
                          />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400">Height (body)</label>
                          <input
                            type="number"
                            min={60}
                            className="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1"
                            value={d.h ?? 80}
                            onChange={(e) =>
                              update({ h: parseInt(e.target.value || "80", 10) as any })
                            }
                          />
                        </div>
                      </div>

                      <div className="mt-2 text-xs text-slate-400">
                        <div>NB Interfaces: {nbIf?.length || 0}</div>
                        <div>NB Rear Ports: {nbRear?.length || 0}</div>
                        <div>NB Front Ports: {nbFront?.length || 0}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </aside>
      </div>

      {/* Modals */}
      {addOpen && (
        <AddEquipmentModal
          open={addOpen}
          onClose={() => setAddOpen(false)}
          onSubmit={handleAddSubmit}
        />
      )}

      <NetboxImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        graph={graph}
        setGraph={setGraph}
      />

      <NetboxExportDeviceModal
        open={exportDeviceOpen}
        onClose={() => setExportDeviceOpen(false)}
        sourceDevice={(function () {
          const id = Array.from(selectedIds)[0];
          return graph.devices.find((d) => d.id === id) || null;
        })()}
      />

      <NetboxExportPortsModal
        open={exportPortsOpen}
        onClose={() => setExportPortsOpen(false)}
        sourceDevice={(function () {
          const id = Array.from(selectedIds)[0];
          return graph.devices.find((d) => d.id === id) || null;
        })()}
      />

      <NBPortModal
        open={portModalOpen}
        onClose={() => setPortModalOpen(false)}
        kind={portKind}
        onCreate={addNBPort}
        choices={nbChoices}
        rearOptions={(() => {
          const id = Array.from(selectedIds)[0];
          const dev = graph.devices.find((d) => d.id === id) as any;
          const arr = dev?.__nb_rear_ports as RearPortInput[] | undefined;
          return (arr || []).map((r, i) => ({
            id: i + 1,
            name: r.name,
            positions: r.positions || 1,
          }));
        })()}
      />

      {/* Bottom bar */}
      <footer className="h-12 shrink-0 border-t border-slate-700/60 px-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <input
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder="AI: 'add 3 cameras'"
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 w-[28rem]"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSaveFile}
            className="px-3 py-2 rounded bg-slate-700 hover:bg-slate-600"
          >
            Save
          </button>
        </div>
      </footer>
    </div>
  );
}
