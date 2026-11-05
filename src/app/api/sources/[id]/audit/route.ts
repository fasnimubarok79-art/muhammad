import { existsSync } from "node:fs";
import { db } from "@/lib/db";
import { ownedSource } from "@/lib/access";
import { env } from "@/lib/env";
import { authedRoute, json } from "@/lib/http";
import { buildAudit } from "@/lib/media/audit";
import { probe, type ProbeResult } from "@/lib/media/probe";
import type { Word } from "@/lib/media/subtitles";
import { keyPath } from "@/lib/storage";
import { idSchema } from "@/lib/validators";

/** Audit report for one source video. `?download=1` returns it as a JSON file. */
export const GET = authedRoute<{ id: string }>(async ({ req, user, params }) => {
  const src = await ownedSource(user.id, idSchema.parse(params.id));
  const [transcript, clips] = await Promise.all([
    db.transcript.findUnique({ where: { sourceVideoId: src.id } }),
    db.clip.findMany({ where: { sourceVideoId: src.id, project: { userId: user.id } }, select: { id: true, title: true, startSec: true, endSec: true, score: true, hookScore: true, hookText: true, insights: true, _count: { select: { segments: true } } } }),
  ]);

  let info: ProbeResult | null = null;
  let probeError: string | undefined;
  if (!src.storageKey) probeError = "This source has no stored media file.";
  else if (!existsSync(keyPath(src.storageKey))) probeError = "The stored media file is missing.";
  else {
    try {
      info = await probe(env().FFPROBE_PATH, keyPath(src.storageKey));
    } catch {
      probeError = "ffprobe could not read the stored file.";
    }
  }

  const report = buildAudit({
    source: { ...src, sizeBytes: src.sizeBytes === null ? null : Number(src.sizeBytes) },
    probe: info,
    probeError,
    transcript: transcript ? { language: transcript.language, engine: transcript.engine, words: (transcript.wordsJson as unknown as Word[]) ?? [] } : null,
    clips: clips.map((c) => ({ ...c, segments: c._count.segments })),
  });

  const res = json({ report });
  if (req.nextUrl.searchParams.get("download") === "1") {
    const safe = (report.file.name ?? "video").replace(/[^\w.-]+/g, "_").slice(0, 60);
    res.headers.set("Content-Disposition", `attachment; filename="audit-${safe}.json"`);
  }
  return res;
});
