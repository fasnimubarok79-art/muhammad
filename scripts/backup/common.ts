/**
 * Shared helpers for backup.ts and restore.ts. Works on Windows and Linux (uses node, tar, git and
 * the PostgreSQL client tools; no shell).
 */
import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

export const ROOT = path.resolve(__dirname, "..", "..");
export const MAGIC = Buffer.from("CKBK1"); // file header for encrypted backup parts

export function log(msg: string) {
  console.log(`[backup] ${msg}`);
}

/** Run a program with arguments (no shell). Resolves with stdout; rejects with a short stderr tail. */
export function run(bin: string, args: string[], opts: { cwd?: string; env?: Record<string, string | undefined>; stdoutFile?: string } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env } as NodeJS.ProcessEnv, shell: false, windowsHide: true });
    const out: Buffer[] = [];
    let err = "";
    if (opts.stdoutFile) child.stdout.pipe(createWriteStream(opts.stdoutFile));
    else child.stdout.on("data", (b: Buffer) => out.push(b));
    child.stderr.on("data", (b: Buffer) => (err = (err + b.toString()).slice(-3000)));
    child.on("error", (e) => reject(new Error(`${bin} could not start: ${e.message}`)));
    child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out).toString("utf8")) : reject(new Error(`${path.basename(bin)} exited ${code}: ${err.trim().slice(-800)}`))));
  });
}

export async function sha256File(file: string): Promise<string> {
  const h = createHash("sha256");
  await pipeline(createReadStream(file), h);
  return h.digest("hex");
}

/** Find a PostgreSQL client tool: explicit env, PATH, then the usual Windows install folders. */
export function pgTool(name: "pg_dump" | "pg_restore" | "psql"): string {
  const envKey = `PG_${name.toUpperCase().replace("PG_", "")}`;
  if (process.env[envKey]) return process.env[envKey]!;
  if (process.platform === "win32") {
    const base = "C:\\Program Files\\PostgreSQL";
    if (existsSync(base)) {
      const versions = readdirSync(base).filter((v) => /^\d+/.test(v)).sort((a, b) => Number(b) - Number(a));
      for (const v of versions) {
        const p = path.join(base, v, "bin", `${name}.exe`);
        if (existsSync(p)) return p;
      }
    }
    return `${name}.exe`;
  }
  return name;
}

/** Split DATABASE_URL into libpq environment variables, so the password never appears in arguments. */
export function pgEnv(url: string, database?: string): Record<string, string> {
  const u = new URL(url);
  return {
    PGHOST: u.hostname,
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: database ?? u.pathname.replace(/^\//, ""),
  };
}

// ---------- encryption (AES-256-GCM, streaming) ----------
// Layout: "CKBK1" | 12-byte IV | ciphertext | 16-byte auth tag

export async function loadOrCreateKey(keyFile: string, create: boolean): Promise<Buffer> {
  if (existsSync(keyFile)) {
    const hex = (await readFile(keyFile, "utf8")).trim();
    if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error(`Key file ${keyFile} is not a 64-character hex key`);
    return Buffer.from(hex, "hex");
  }
  if (!create) throw new Error(`Backup key not found: ${keyFile}`);
  await mkdir(path.dirname(keyFile), { recursive: true });
  const key = randomBytes(32);
  await writeFile(keyFile, key.toString("hex") + "\n", { mode: 0o600 });
  log(`created a new backup key: ${keyFile} (keep it separate from the backups; without it encrypted parts cannot be restored)`);
  return key;
}

export async function encryptFile(src: string, dest: string, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const out = createWriteStream(dest);
  out.write(MAGIC);
  out.write(iv);
  await pipeline(createReadStream(src), cipher, out, { end: false });
  await new Promise<void>((resolve, reject) => out.end(cipher.getAuthTag(), (e?: Error | null) => (e ? reject(e) : resolve())));
}

export async function decryptFile(src: string, dest: string, key: Buffer) {
  const size = statSync(src).size;
  const head = Buffer.alloc(MAGIC.length + 12);
  const tag = Buffer.alloc(16);
  const fh = await import("node:fs/promises").then((m) => m.open(src, "r"));
  try {
    await fh.read(head, 0, head.length, 0);
    await fh.read(tag, 0, 16, size - 16);
  } finally {
    await fh.close();
  }
  if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error(`${path.basename(src)} is not a ClipKita encrypted backup part`);
  const decipher = createDecipheriv("aes-256-gcm", key, head.subarray(MAGIC.length));
  decipher.setAuthTag(tag);
  await pipeline(createReadStream(src, { start: head.length, end: size - 17 }), decipher, createWriteStream(dest));
}

/** A tiny encrypted marker stored in the manifest, so a wrong key is detected before restoring anything. */
export function makeKeyCheck(key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update("clipkita-key-check", "utf8"), c.final()]);
  return Buffer.concat([iv, enc, c.getAuthTag()]).toString("base64");
}

export function keyMatches(check: string, key: Buffer): boolean {
  try {
    const b = Buffer.from(check, "base64");
    const d = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
    d.setAuthTag(b.subarray(b.length - 16));
    return Buffer.concat([d.update(b.subarray(12, b.length - 16)), d.final()]).toString("utf8") === "clipkita-key-check";
  } catch {
    return false;
  }
}

export function humanSize(n: number) {
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

/** Recursively list files (relative paths, forward slashes). */
export function listFiles(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, base));
    else if (e.isFile()) out.push(path.relative(base, p).split(path.sep).join("/"));
  }
  return out;
}

export type Manifest = {
  version: string;
  createdAt: string;
  project: { root: string; gitCommit: string; gitDirty: string[] };
  runtime: Record<string, string>;
  database: { name: string; tables: Record<string, number>; migrations: string[] } | null;
  assets: { files: number; bytes: number } | null;
  parts: Array<{ path: string; bytes: number; sha256: string; encrypted: boolean; category: string }>;
  excluded: string[];
  warnings: string[];
  keyCheck?: string;
};
