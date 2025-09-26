import React, { useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    type: string;
    quantity: number;
    customNameBase?: string;
    manufacturer?: string;
    model?: string;
    color?: string;
    w?: number;
    h?: number;
    inPorts?: { type: string; quantity: number };
    outPorts?: { type: string; quantity: number };
  }) => void;
};

export default function AddEquipmentModal({ open, onClose, onSubmit }: Props) {
  const [type, setType] = useState("camera");
  const [quantity, setQuantity] = useState(1);
  const [customNameBase, setCustomNameBase] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [color, setColor] = useState("#1f2937");
  const [w, setW] = useState(160);
  const [h, setH] = useState(80);
  const [inType, setInType] = useState("SDI");
  const [inQty, setInQty] = useState(0);
  const [outType, setOutType] = useState("SDI");
  const [outQty, setOutQty] = useState(1);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Add Equipment</h2>
          <button onClick={onClose} className="text-slate-300 hover:text-white">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-slate-300">Type</label>
            <input value={type} onChange={(e) => setType(e.target.value)}
              className="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1" />
          </div>
          <div>
            <label className="text-xs text-slate-300">Quantity</label>
            <input type="number" min={1} value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value || "1"))}
              className="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1" />
          </div>

          <div>
            <label className="text-xs text-slate-300">Custom Name (optional)</label>
            <input value={customNameBase} onChange={(e) => setCustomNameBase(e.target.value)}
              className="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1" />
          </div>
          <div>
            <label className="text-xs text-slate-300">Color</label>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
              className="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 h-[34px] p-1" />
          </div>

          <div>
            <label className="text-xs text-slate-300">Manufacturer</label>
            <input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)}
              className="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1" />
          </div>
          <div>
            <label className="text-xs text-slate-300">Model</label>
            <input value={model} onChange={(e) => setModel(e.target.value)}
              className="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1" />
          </div>

          <div>
            <label className="text-xs text-slate-300">Width</label>
            <input type="number" min={40} value={w}
              onChange={(e) => setW(parseInt(e.target.value || "160", 10))}
              className="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1" />
          </div>
          <div>
            <label className="text-xs text-slate-300">Height</label>
            <input type="number" min={20} value={h}
              onChange={(e) => setH(parseInt(e.target.value || "80", 10))}
              className="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1" />
          </div>

          <div className="rounded-xl border border-slate-700 p-3 col-span-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-xl border border-slate-700 p-3">
                <div className="font-medium mb-2">IN Ports (left)</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-slate-300">Type</label>
                    <input value={inType} onChange={(e) => setInType(e.target.value)}
                      className="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-300">Qty</label>
                    <input type="number" min={0} value={inQty}
                      onChange={(e) => setInQty(parseInt(e.target.value || "0"))}
                      className="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1" />
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-slate-700 p-3">
                <div className="font-medium mb-2">OUT Ports (right)</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-slate-300">Type</label>
                    <input value={outType} onChange={(e) => setOutType(e.target.value)}
                      className="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-300">Qty</label>
                    <input type="number" min={0} value={outQty}
                      onChange={(e) => setOutQty(parseInt(e.target.value || "0"))}
                      className="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded bg-slate-700 hover:bg-slate-600">Cancel</button>
          <button
            onClick={() =>
              onSubmit({
                type,
                quantity,
                customNameBase,
                manufacturer,
                model,
                color,
                w,
                h,
                inPorts: { type: inType, quantity: inQty },
                outPorts: { type: outType, quantity: outQty },
              })
            }
            className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-700"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
