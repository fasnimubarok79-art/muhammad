import { spawn } from "node:child_process";
import { ownedClip } from "@/lib/access";
import { env } from "@/lib/env";
import { ApiError, authedRoute, json } from "@/lib/http";
import { RATE } from "@/lib/rate-limit";
import { keyPath } from "@/lib/storage";
import { idSchema } from "@/lib/validators";

export const runtime = "nodejs";

const cache = new Map<string, number[]>();

/** Peak amplitudes (0..1) of the clip's real audio, computed by ffmpeg. */
export const GET = authedRoute<{ id: string }>(
  async ({ user, params }) => {
    const clip = await ownedClip(user.id, idSchema.parse(params.id));
    const src = clip.sourceVideo;
    if (!src.storageKey || !src.hasAudio) return json({ peaks: [], hasAudio: false });
    const buckets = 600;
    const cacheKey = `${clip.id}:${clip.startSec}:${clip.endSec}`;
    if (cache.has(cacheKey)) return json({ peaks: cache.get(cacheKey), hasAudio: true });
    const rate = 4000;
    const dur = clip.endSec - clip.startSec;
    const pcm: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const p = spawn(env().FFMPEG_PATH, ["-hide_banner", "-nostdin", "-ss", clip.startSec.toFixed(3), "-t", dur.toFixed(3), "-i", keyPath(src.storageKey!), "-vn", "-ac", "1", "-ar", String(rate), "-f", "s16le", "pipe:1"], { stdio: ["ignore", "pipe", "ignore"] });
      const timer = setTimeout(() => p.kill("SIGKILL"), 60_000);
      let size = 0;
      p.stdout.on("data", (b: Buffer) => {
        size += b.length;
        if (size < 64 * 1024 * 1024) pcm.push(b);
      });
      p.on("error", reject);
      p.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new ApiError(500, "WAVEFORM_FAILED", "Could not read audio"));
      });
    });
    const buf = Buffer.concat(pcm);
    const samples = Math.floor(buf.length / 2);
    const per = Math.max(1, Math.floor(samples / buckets));
    const peaks: number[] = [];
    for (let b = 0; b < buckets && b * per < samples; b++) {
      let max = 0;
      for (let i = b * per; i < Math.min(samples, (b + 1) * per); i++) max = Math.max(max, Math.abs(buf.readInt16LE(i * 2)));
      peaks.push(Number((max / 32768).toFixed(3)));
    }
    if (cache.size > 200) cache.clear();
    cache.set(cacheKey, peaks);
    return json({ peaks, hasAudio: true });
  },
  { rate: RATE.read, rateKey: "waveform" },
);
