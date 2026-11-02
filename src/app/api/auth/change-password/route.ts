import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { ApiError, authedRoute, json, parseJson } from "@/lib/http";
import { RATE } from "@/lib/rate-limit";
import { passwordSchema } from "@/lib/validators";
import { readSession } from "@/lib/auth";

const Body = z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema });

export const POST = authedRoute(
  async ({ req, user, ip }) => {
    const body = await parseJson(req, Body);
    if (body.currentPassword === body.newPassword) throw new ApiError(400, "SAME_PASSWORD", "Choose a different password");
    const u = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await verifyPassword(body.currentPassword, u.passwordHash))) throw new ApiError(401, "BAD_CREDENTIALS", "Current password is incorrect");
    const current = await readSession();
    await db.$transaction([
      db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(body.newPassword), mustChangePassword: false } }),
      // sign out every other session
      db.session.deleteMany({ where: { userId: user.id, NOT: { id: current?.sessionId } } }),
    ]);
    await audit("auth.password_changed", { userId: user.id, ip });
    return json({ ok: true });
  },
  { allowPasswordChange: true, rate: RATE.auth, rateKey: "change-password" },
);
