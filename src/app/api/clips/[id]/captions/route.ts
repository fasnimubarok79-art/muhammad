import { db } from "@/lib/db";
import { ownedClip } from "@/lib/access";
import { replaceSegments } from "@/lib/clip-subtitles";
import { ApiError, authedRoute, json } from "@/lib/http";
import { parseCaptions, toSrt, toVtt } from "@/lib/media/subtitles";
import { RATE } from "@/lib/rate-limit";
import { idSchema } from "@/lib/validators";

type P = { id: string };

/** Export SRT or VTT: GET ?format=srt|vtt */
export const GET = authedRoute<P>(async ({ req, user, params }) => {
  const clip = await ownedClip(user.id, idSchema.parse(params.id));
  const format = req.nextUrl.searchParams.get("format") === "vtt" ? "vtt" : "srt";
  const segs = await db.subtitleSegment.findMany({ where: { clipId: clip.id }, orderBy: { idx: "asc" } });
  const rows = segs.map((s) => ({ start: s.startSec, end: s.endSec, text: s.text }));
  const body = format === "vtt" ? toVtt(rows) : toSrt(rows);
  const safeName = clip.title.replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 60) || "subtitles";
  return new Response(body, {
    headers: {
      "Content-Type": format === "vtt" ? "text/vtt; charset=utf-8" : "application/x-subrip; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}.${format}`,
      "Cache-Control": "no-store",
    },
  });
});

/** Import SRT or VTT (raw text body, max 512 KB). Replaces the clip's segments. */
export const POST = authedRoute<P>(
  async ({ req, user, params }) => {
    const clip = await ownedClip(user.id, idSchema.parse(params.id));
    const text = await req.text();
    if (text.length > 512 * 1024) throw new ApiError(413, "TOO_LARGE", "Subtitle file is too large");
    let segs;
    try {
      segs = parseCaptions(text);
    } catch (e) {
      throw new ApiError(400, "BAD_CAPTIONS", e instanceof Error ? e.message : "Could not read the subtitle file");
    }
    const len = clip.endSec - clip.startSec;
    const inside = segs.filter((s) => s.start < len).map((s) => ({ ...s, end: Math.min(s.end, len) }));
    if (!inside.length) throw new ApiError(400, "BAD_CAPTIONS", "No cues fall inside this clip");
    await replaceSegments(clip.id, inside);
    return json({ ok: true, count: inside.length, skipped: segs.length - inside.length });
  },
  { rate: RATE.write },
);
