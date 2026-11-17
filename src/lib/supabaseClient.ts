import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export const apiUrl = (import.meta.env.VITE_API_URL || `${window.location.origin}/api`).replace(/\/+$/, "");
const anonKey = "fizlab-public-client";
const deviceKey = "fizlab:device-id";
let memoryDeviceId: string | undefined;
export function deviceId() {
  try {
    const stored = localStorage.getItem(deviceKey);
    if (stored) return stored;
  } catch { /* Some browsers disable storage; keep one ID for this page session. */ }
  memoryDeviceId ??= crypto.randomUUID();
  try { localStorage.setItem(deviceKey, memoryDeviceId); }
  catch { /* Auth must still work when browser storage is unavailable. */ }
  return memoryDeviceId;
}

/** The app uses its same-origin API unless a mobile API origin is configured. */
export const isSupabaseConfigured = Boolean(apiUrl && anonKey);

export const supabase = createClient<Database>(
  apiUrl,
  anonKey,
  {
    global: {
      fetch: (input, init) => {
        const timeout = AbortSignal.timeout(12000);
        const headers = new Headers(init?.headers);
        headers.set("x-fizlab-device-id", deviceId());
        return fetch(input, {
          ...init,
          headers,
          signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
        });
      },
    },
  },
);
