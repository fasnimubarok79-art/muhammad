import { z } from "zod";
import { db } from "@/lib/db";
import { authedRoute, json, parseJson } from "@/lib/http";
import { RATE } from "@/lib/rate-limit";

const Body = z.object({ name: z.string().trim().min(1).max(80) });

/** Update the signed-in user's profile (display name). */
export const PATCH = authedRoute(
  async ({ req, user }) => {
    const { name } = await parseJson(req, Body);
    const u = await db.user.update({ where: { id: user.id }, data: { name }, select: { name: true } });
    return json({ ok: true, name: u.name });
  },
  { rate: RATE.write },
);
