import { db } from "@/lib/db";
import { ownedSource } from "@/lib/access";
import { authedRoute, json, notFound } from "@/lib/http";
import { idSchema } from "@/lib/validators";

export const GET = authedRoute<{ id: string }>(async ({ user, params }) => {
  const src = await ownedSource(user.id, idSchema.parse(params.id));
  const t = await db.transcript.findUnique({ where: { sourceVideoId: src.id } });
  if (!t) throw notFound("Transcript");
  return json({ transcript: { language: t.language, engine: t.engine, text: t.text, words: t.wordsJson, createdAt: t.createdAt } });
});
