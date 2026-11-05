import { z } from "zod";
import { db } from "@/lib/db";
import { ownedClip } from "@/lib/access";
import { env } from "@/lib/env";
import { authedRoute, json, parseJson } from "@/lib/http";
import { RATE } from "@/lib/rate-limit";
import { generateTitle } from "@/lib/media/gemini";
import { idSchema } from "@/lib/validators";

type P = { id: string };

const Body = z.object({
  transcript: z.string().trim().min(5).max(5000),
});

export const POST = authedRoute<P>(
  async ({ req, user, params }) => {
    const clip = await ownedClip(user.id, idSchema.parse(params.id));
    const body = await parseJson(req, Body);
    const key = env().GEMINI_API_KEY;
    if (!key) {
      return json(
        {
          error: {
            code: "GEMINI_NOT_CONFIGURED",
            message: "GEMINI_API_KEY is not configured. Set it in .env to generate AI titles and hooks.",
          },
        },
        409,
      );
    }
    const { title, hook, confidence } = await generateTitle(body.transcript);
    // Persist the AI suggestion as an editConfig hint so it survives undo/redo and saves.
    await db.clip.update({
      where: { id: clip.id },
      data: {
        editConfig: {
          ...(clip.editConfig as Record<string, unknown> | null),
          aiTitle: { title, hook, confidence, generatedAt: new Date().toISOString() },
        },
      },
    });
    return json({ title, hook, confidence });
  },
  { rate: RATE.write },
);
