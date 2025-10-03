import React, { useEffect, useState } from "react";
import { fetchNetboxSites, prepareNetboxDevice, createNetboxDeviceFromPayload } from "../lib/api";

type Props = {
  open: boolean;
  onClose: () => void;
  defaultName: string;
};

export default function NetboxExportModal({ open, onClose, defaultName }: Props) {
  const [sites, setSites] = useState<{ slug: string; name: string }[]>([]);
  const [site, setSite] = useState("");
  const [role, setRole] = useState("core-switch");
  const [dtype, setDtype] = useState("c9300-24t");
  const [status, setStatus] = useState("active");
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState(defaultName);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const s = await fetchNetboxSites(200);
      setSites(s);
      if (s.length) setSite(s[0].slug || s[0].name);
    })();
  }, [open]);

  const submit = async () => {
    setSubmitting(true);
    try {
      const prep = await prepareNetboxDevice({ name, site, role, device_type: dtype, status });
      await createNetboxDeviceFromPayload(prep.payload);
      alert("Device created in NetBox.");
      onClose();
    } catch (e: any) {
      alert("Failed: " + (e?.message || String(e)));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "grid", placeItems: "center", zIndex: 50 }}>
      <div style={{ width: 560, background: "#0b1220", border: "1px solid #26324b", borderRadius: 12, padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Export to NetBox</h3>
        <div className="grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label>
            <div style={{ fontSize: 12, color: "#cbd5e1" }}>Name</div>
            <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%", marginTop: 6, background: "#0f172a", color: "white", border: "1px solid #334155", borderRadius: 8, padding: "8px 10px" }} />
          </label>
          <label>
            <div style={{ fontSize: 12, color: "#cbd5e1" }}>Site</div>
            <select value={site} onChange={(e) => setSite(e.target.value)} style={{ width: "100%", marginTop: 6, background: "#0f172a", color: "white", border: "1px solid #334155", borderRadius: 8, padding: "8px 10px" }}>
              {sites.map((s) => (
                <option key={s.slug} value={s.slug}>{s.name} ({s.slug})</option>
              ))}
            </select>
          </label>
          <label>
            <div style={{ fontSize: 12, color: "#cbd5e1" }}>Role</div>
            <input value={role} onChange={(e) => setRole(e.target.value)} style={{ width: "100%", marginTop: 6, background: "#0f172a", color: "white", border: "1px solid #334155", borderRadius: 8, padding: "8px 10px" }} />
          </label>
          <label>
            <div style={{ fontSize: 12, color: "#cbd5e1" }}>Device Type</div>
            <input value={dtype} onChange={(e) => setDtype(e.target.value)} style={{ width: "100%", marginTop: 6, background: "#0f172a", color: "white", border: "1px solid #334155", borderRadius: 8, padding: "8px 10px" }} />
          </label>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button onClick={onClose} style={{ padding: "8px 12px", borderRadius: 8, background: "#1f2937", border: "1px solid #334155" }}>
            Cancel
          </button>
          <button onClick={submit} disabled={submitting} style={{ padding: "8px 12px", borderRadius: 8, background: "#2563eb", border: "1px solid #1d4ed8" }}>
            {submitting ? "Exporting…" : "Create in NetBox"}
          </button>
        </div>
      </div>
    </div>
  );
}
