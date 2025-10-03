import React, { useState } from "react";
import { fetchNetboxDevices, type NetboxDevice } from "../lib/api";
import type { GraphState, Device as LDevice } from "../lib/editor";

type Props = {
  graph: GraphState;
  setGraph: (g: GraphState) => void;
};

export default function ImportFromNetbox({ graph, setGraph }: Props) {
  const [loading, setLoading] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function handleImport() {
    try {
      setLoading(true);
      setErr(null);
      const devices = await fetchNetboxDevices(100);

      // map NetBox devices -> Leonardo nodes
      const existingIds = new Set(graph.devices.map(d => d.id));
      let x = 40, y = 40, dx = 260, dy = 160, perRow = 4, i = 0;

      const toAdd: LDevice[] = devices
        .filter(d => !!d.name && !existingIds.has(d.name))
        .map((d) => {
          const col = i % perRow;
          const row = Math.floor(i / perRow);
          const id = d.name; // keep NetBox name as Leonardo node id
          const type =
            d.device_role?.slug ||
            d.device_role?.name ||
            d.device_type?.model ||
            "device";
          const node: LDevice = {
            id,
            type,
            x: x + col * dx,
            y: y + row * dy,
            w: 200,
            h: 100,
            ports: [], // keep empty for now; can enrich later from NetBox interfaces
          };
          i += 1;
          return node;
        });

      if (toAdd.length === 0) {
        setCount(0);
        return;
      }

      setGraph({
        ...graph,
        devices: [...graph.devices, ...toAdd],
      });

      setCount(toAdd.length);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <button
        onClick={handleImport}
        disabled={loading}
        style={{
          padding: "6px 10px",
          borderRadius: 6,
          border: "1px solid #ccc",
          background: loading ? "#e6e6e6" : "white",
          cursor: loading ? "default" : "pointer",
        }}
        title="Fetch devices from NetBox (via backend) and add to the canvas"
      >
        {loading ? "Importing…" : "Import from NetBox"}
      </button>
      {count !== null && <span style={{ opacity: 0.7 }}>Imported {count} device(s)</span>}
      {err && <span style={{ color: "crimson" }}>{err}</span>}
    </div>
  );
}
