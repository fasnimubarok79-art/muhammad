import { z } from "zod";
import { authedRoute, json, parseJson } from "@/lib/http";
import { RATE } from "@/lib/rate-limit";
import { checkRefs, loadOrCreateTimeline, mediaInfos, rowsToDoc, saveTimeline } from "@/lib/timeline/store";
import { idSchema } from "@/lib/validators";

type P = { id: string };

/** The clip's timeline (created from its saved settings on first open) and the facts of its media. */
export const GET = authedRoute<P>(async ({ user, params }) => {
  const { row } = await loadOrCreateTimeline(user.id, idSchema.parse(params.id));
  const doc = rowsToDoc(row);
  const { assets, sources } = await checkRefs(user.id, doc);
  return json({ timeline: doc, version: row.version, media: mediaInfos(assets, sources) });
});

const Body = z.object({ version: z.number().int().min(1), timeline: z.unknown() });

export const PUT = authedRoute<P>(
  async ({ req, user, params }) => {
    const body = await parseJson(req, Body);
    const r = await saveTimeline(user.id, idSchema.parse(params.id), body.version, body.timeline);
    return json(r);
  },
  { rate: RATE.write },
);
