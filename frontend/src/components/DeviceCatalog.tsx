import React from "react";

type Device = {
    id: string;
    role?: string;
};

type Props = {
    devices?: Device[];
};

export default function DeviceCatalog({ devices = [] }: Props) {
    return (
        <div style={{ padding: 12 }}>
            <h2 style={{ margin: 0 }}>Device Catalog</h2>
            {devices.length === 0 ? (
                <p style={{ opacity: 0.7 }}>No devices yet.</p>
            ) : (
                <ul>
                    {devices.map((d) => (
                        <li key={d.id}>
                            <strong>{d.id}</strong>
                            {d.role ? ` — ${d.role}` : null}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
