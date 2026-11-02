import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, sha256 } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { ApiError, json, parseJson, publicRoute } from "@/lib/http";
import { RATE } from "@/lib/rate-limit";
import { passwordSchema } from "@/lib/validators";

const Body = z.object({ token: z.string().min(20).max(200), newPassword: passwordSchema });

export const POST = publicRoute(
  async ({ req, ip }) => {
    const body = await parseJson(req, Body);
    const id = sha256(body.token);
    await db.$transaction(async (tx) => {
      const used = await tx.passwordResetToken.updateMany({ where: { id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (used.count === 0) throw new ApiError(400, "BAD_TOKEN", "This reset link is invalid or has expired");
      const t = await tx.passwordResetToken.findUniqueOrThrow({ where: { id } });
      await tx.user.update({ where: { id: t.userId }, data: { passwordHash: await hashPassword(body.newPassword), mustChangePassword: false } });
      await tx.session.deleteMany({ where: { userId: t.userId } });
      await audit("auth.password_reset", { userId: t.userId, ip }, tx);
    });
    return json({ ok: true });
  },
  { rate: RATE.auth, rateKey: "reset" },
);
