import { z } from "zod";
import { db } from "@/lib/db";
import { randomToken, sha256 } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { json, parseJson, publicRoute } from "@/lib/http";
import { RATE } from "@/lib/rate-limit";
import { emailSchema } from "@/lib/validators";
import { env } from "@/lib/env";
import { sendResetEmail } from "@/lib/mailer";

const Body = z.object({ email: emailSchema });

/** Always answers the same way, so it cannot be used to discover which emails have accounts. */
export const POST = publicRoute(
  async ({ req, ip }) => {
    const { email } = await parseJson(req, Body);
    const user = await db.user.findUnique({ where: { email } });
    if (user && !user.disabledAt) {
      const raw = randomToken(32);
      await db.passwordResetToken.create({ data: { id: sha256(raw), userId: user.id, expiresAt: new Date(Date.now() + 30 * 60_000) } });
      const link = `${env().APP_URL}/reset?token=${raw}`;
      await sendResetEmail(user.email, link);
      await audit("auth.reset_requested", { userId: user.id, ip });
    }
    return json({ ok: true, message: "If that email has an account, a reset link has been sent." });
  },
  { rate: RATE.forgot, rateKey: "forgot" },
);
