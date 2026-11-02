"use client";

export type ApiErrorBody = { code: string; message: string; [k: string]: unknown };

export class ClientApiError extends Error {
  constructor(public status: number, public body: ApiErrorBody) {
    super(body.message);
  }
}

let csrf: string | null = null;

export async function loadSession() {
  const r = await fetch("/api/auth/me", { cache: "no-store" });
  const data = await r.json();
  csrf = data.csrfToken ?? null;
  return data.user as null | { id: string; email: string; name: string | null; role: "USER" | "OWNER_ADMIN"; tokenBalance: number; mustChangePassword: boolean; unlimited: boolean };
}

export function setCsrf(token: string | null) {
  csrf = token;
}

/** fetch wrapper: JSON, CSRF header on writes, readable errors, auth redirects. */
export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; raw?: BodyInit; headers?: Record<string, string> } = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined || opts.raw ? "POST" : "GET");
  if (method !== "GET" && !csrf) await loadSession();
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (method !== "GET" && csrf) headers["x-csrf-token"] = csrf;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(path, { method, headers, body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined), cache: "no-store" });
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : null;
  if (!res.ok) {
    const body: ApiErrorBody = data?.error ?? { code: "HTTP_" + res.status, message: res.statusText || "Request failed" };
    if (res.status === 401 && typeof window !== "undefined" && !location.pathname.startsWith("/login")) location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
    if (body.code === "PASSWORD_CHANGE_REQUIRED" && typeof window !== "undefined") location.href = "/change-password";
    throw new ClientApiError(res.status, body);
  }
  return data as T;
}

export function newIdempotencyKey() {
  return (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/[^A-Za-z0-9_-]/g, "");
}

export function fmtTime(sec: number | null | undefined, withMs = true) {
  if (sec == null || !Number.isFinite(sec)) return "--:--";
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${String(m).padStart(2, "0")}:${withMs ? r.toFixed(2).padStart(5, "0") : String(Math.floor(r)).padStart(2, "0")}`;
}

export function fmtBytes(n: number | null | undefined) {
  if (!n) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
}
