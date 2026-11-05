import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { randomToken } from "./crypto";
import { env } from "./env";

const KEY_RE = /^[a-z]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/;

/** Storage keys are generated server-side only: "<area>/<ownerId>/<random>.<ext>". */
export function newKey(area: "sources" | "renders" | "thumbs" | "audio" | "work" | "assets", ownerId: string, ext: string) {
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 5) || "bin";
  return `${area}/${ownerId.replace(/[^A-Za-z0-9_-]/g, "")}/${Date.now()}-${randomToken(9)}.${safeExt}`;
}

/** Resolve a key to an absolute path, refusing anything that escapes STORAGE_DIR. */
export function keyPath(key: string, base = env().STORAGE_DIR): string {
  if (!KEY_RE.test(key) || key.includes("..")) throw new Error("Invalid storage key");
  const root = path.resolve(base);
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error("Invalid storage key");
  return full;
}

export async function ensureDirFor(key: string) {
  await mkdir(path.dirname(keyPath(key)), { recursive: true });
}

/**
 * Clean up temporary work files older than `maxAgeHours` (default 24h) from the
 * work storage area. Best-effort: individual file failures are ignored.
 */
export async function cleanupWorkTemp(maxAgeHours = 24): Promise<{ removed: number; bytes: number }> {
  const root = path.resolve(env().STORAGE_DIR, "work");
  let removed = 0;
  let bytes = 0;
  try {
    const entries = await readdir(root, { recursive: true });
    const now = Date.now();
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
    for (const rel of entries) {
      const full = path.join(root, rel);
      const st = await stat(full).catch(() => null);
      if (!st || !st.isFile()) continue;
      if (now - st.mtimeMs < maxAgeMs) continue;
      bytes += st.size;
      await rm(full, { force: true }).catch(() => undefined);
      removed++;
    }
  } catch {
    // work directory may not exist yet
  }
  return { removed, bytes };
}

