import React, { useEffect, useState } from "react";
import { fetchNetboxSites, fetchNetboxDevicesBySite, type NetboxSite, type NetboxDevice } from "../lib/api";
import type { GraphState, Device as LDevice } from "../lib/editor";

type Props = {
  open: boolean;
  onClose: () => void;
  graph: GraphState;
  setGraph: (g: GraphState) => void;
};

export default function NetboxImportModal({ open, onClose, graph, setGraph }: Props) {
  const [sites, setSites] = useState<NetboxSite[]>([]);
  const [site, setSite] = useState<string>("");
  const [devices, setDevices] = useState<NetboxDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState<Record<number, boolean>>({});

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

  const importSelected = () => {
    const existing = new Set(graph.devices.map((d) => d.id));
    let i = 0, x0 = 60, y0 = 60, dx = 260, dy = 160, perRow = 4;
    const toAdd: LDevice[] = devices
      .filter((d) => checked[d.id])
      .filter((d) => d.name && !existing.has(d.name))
      .map((d) => {
        const col = i % perRow, row = Math.floor(i / perRow);
        i++;
        const type =
          d.device_role?.slug || d.device_role?.name || d.device_type?.model || "device";
        return {
          id: d.name,
          type,
          x: x0 + col * dx,
          y: y0 + row * dy,
          w: 200,
          h: 100,
          ports: [],
        };
      });

    if (toAdd.length) {
      setGraph({ ...graph, devices: [...graph.devices, ...toAdd] });
    }
    onClose();
  };

  if (!open) return null;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "grid", placeItems: "center", zIndex: 50 }}>
      <div style={{ width: 720, maxHeight: "80vh", overflow: "auto", background: "#0b1220", border: "1px solid #26324b", borderRadius: 12, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>NetBox Import</h3>
          <button onClick={onClose} style={{ background: "transparent", color: "#ccc" }}>✕</button>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: "#cbd5e1" }}>Site</label>
          <select value={site} onChange={(e) => setSite(e.target.value)} style={{ display: "block", marginTop: 6, width: "100%", background: "#0f172a", color: "white", border: "1px solid #334155", borderRadius: 8, padding: "8px 10px" }}>
            {sites.map((s) => (
              <option key={s.id} value={s.slug || s.name}>
                {s.name} {s.slug ? `(${s.slug})` : ""}
              </option>
            ))}
          </select>
        </div>

        <div style={{ borderTop: "1px solid #1f2a44", marginTop: 8, paddingTop: 10 }}>
          {loading ? (
            <div>Loading devices…</div>
          ) : devices.length === 0 ? (
            <div>No devices in this site.</div>
          ) : (
            <table style={{ width: "100%", fontSize: 14, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#a8b3cf" }}>
                  <th style={{ padding: "6px 4px" }}></th>
                  <th style={{ padding: "6px 4px" }}>Name</th>
                  <th style={{ padding: "6px 4px" }}>Role</th>
                  <th style={{ padding: "6px 4px" }}>Type</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => (
                  <tr key={d.id} style={{ borderTop: "1px solid #1f2a44" }}>
                    <td style={{ padding: "6px 4px" }}>
                      <input type="checkbox" checked={!!checked[d.id]} onChange={() => toggle(d.id)} />
                    </td>
                    <td style={{ padding: "6px 4px" }}>{d.name}</td>
                    <td style={{ padding: "6px 4px" }}>{d.device_role?.slug || d.device_role?.name || "-"}</td>
                    <td style={{ padding: "6px 4px" }}>{d.device_type?.model || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button onClick={onClose} style={{ padding: "8px 12px", borderRadius: 8, background: "#1f2937", border: "1px solid #334155" }}>
            Cancel
          </button>
          <button onClick={importSelected} style={{ padding: "8px 12px", borderRadius: 8, background: "#16a34a", border: "1px solid #046a28" }}>
            Import Selected
          </button>
        </div>
      </div>
    </div>
  );
}
