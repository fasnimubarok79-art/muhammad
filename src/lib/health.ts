import { access, statfs } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { db } from "./db";
import { env } from "./env";
import { run } from "./media/exec";

export type Check = { ok: boolean; detail: string };

async function version(bin: string): Promise<Check> {
  try {
    const out = await run(bin, ["-hide_banner", "-version"], { timeoutMs: 10_000 });
    return { ok: true, detail: out.split("\n")[0].replace(/ Copyright.*/, "") };
  } catch {
    return { ok: false, detail: `${path.basename(bin)} not found or not runnable` };
  }
}

/** Real status of every dependency the pipeline needs. Never returns secret values. */
export async function systemHealth() {
  const e = env();
  const [database, ffmpeg, ffprobe] = await Promise.all([
    db.$queryRaw`SELECT 1`.then(() => ({ ok: true, detail: "connected" }), () => ({ ok: false, detail: "unreachable" })),
    version(e.FFMPEG_PATH),
    version(e.FFPROBE_PATH),
  ]);
  let whisper: Check;
  try {
    const out = await run(e.WHISPER_PYTHON, ["-I", "-c", "import faster_whisper,ctranslate2;print(faster_whisper.__version__)"], { timeoutMs: 20_000 });
    const local = e.WHISPER_MODEL.startsWith("/");
    let modelOk = true;
    if (local) modelOk = await access(path.join(e.WHISPER_MODEL, "model.bin"), constants.R_OK).then(() => true, () => false);
    whisper = { ok: modelOk, detail: `faster-whisper ${out.trim()}; model ${local ? (modelOk ? "files readable" : "files missing") : `"${e.WHISPER_MODEL}" (downloaded on first use)`}` };
  } catch {
    whisper = { ok: false, detail: "faster-whisper is not installed for WHISPER_PYTHON" };
  }
  let storage: Check;
  try {
    const s = await statfs(e.STORAGE_DIR);
    const freeGb = (s.bavail * s.bsize) / 1e9;
    storage = { ok: freeGb > 2, detail: `${freeGb.toFixed(1)} GB free` };
  } catch {
    storage = { ok: false, detail: "STORAGE_DIR is not accessible" };
  }
  const hb = await db.workerHeartbeat.findFirst({ orderBy: { seenAt: "desc" } }).catch(() => null);
  const age = hb ? (Date.now() - hb.seenAt.getTime()) / 1000 : Infinity;
  const worker: Check = { ok: age < 60, detail: hb ? `last heartbeat ${Math.round(age)}s ago` : "no worker has reported yet" };
  return { database, ffmpeg, ffprobe, whisper, storage, worker };
}
