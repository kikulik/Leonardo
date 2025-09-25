// src/lib/api.ts
type Json = Record<string, any>;

const BASE = ""; // use Nginx proxy: frontend -> /api -> backend

async function http<T = Json>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  return (await res.json()) as T;
}

// --- public API wrappers --- //
export async function getCatalog() {
  // GET /catalog → device definitions
  return http("/catalog");
}

export async function generate(instruction: string) {
  // POST /generate → model returns graph JSON
  // Backend expects { instruction }, we keep it minimal for now.
  return http("/generate", {
    method: "POST",
    body: JSON.stringify({ instruction }),
  });
}

export const api = { getCatalog, generate };

// (optional) attach for quick console testing in dev:
if (typeof window !== "undefined") {
  // @ts-ignore
  window.leonardoApi = api;
}
