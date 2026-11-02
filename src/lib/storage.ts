import { mkdir } from "node:fs/promises";
import path from "node:path";
import { randomToken } from "./crypto";
import { env } from "./env";

const KEY_RE = /^[a-z]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/;

/** Storage keys are generated server-side only: "<area>/<ownerId>/<random>.<ext>". */
export function newKey(area: "sources" | "renders" | "thumbs" | "audio" | "work", ownerId: string, ext: string) {
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
