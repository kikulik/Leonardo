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
  // Some versions expect `prompt`, others `instruction`.
  // Send both with the same value for max compatibility.
  return http("/generate", {
    method: "POST",
    body: JSON.stringify({ prompt: instruction, instruction }),
  });
}

export const api = { getCatalog, generate };

// (optional) attach for quick console testing in dev:
if (typeof window !== "undefined") {
  // @ts-ignore
  window.leonardoApi = api;
}
