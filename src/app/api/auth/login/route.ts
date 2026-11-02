import { z } from "zod";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { verifyPassword } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { ApiError, json, parseJson, publicRoute } from "@/lib/http";
import { RATE } from "@/lib/rate-limit";
import { emailSchema } from "@/lib/validators";

const Body = z.object({ email: emailSchema, password: z.string().min(1).max(200) });
// Constant-cost dummy so unknown emails take as long as wrong passwords.
const DUMMY = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(86) + "==";

export const POST = publicRoute(
  async ({ req, ip }) => {
    const body = await parseJson(req, Body);
    const user = await db.user.findUnique({ where: { email: body.email } });
    const ok = await verifyPassword(body.password, user?.passwordHash ?? DUMMY);
    if (!user || !ok || user.disabledAt) {
      await audit("auth.login_failed", { userId: user?.id, ip, meta: { email: body.email } });
      throw new ApiError(401, "BAD_CREDENTIALS", "Email or password is incorrect");
    }
    const { csrfToken } = await createSession(user.id, { ip, userAgent: req.headers.get("user-agent") ?? undefined });
    await audit("auth.login", { userId: user.id, ip });
    return json({ ok: true, csrfToken, mustChangePassword: user.mustChangePassword });
  },
  { rate: RATE.auth, rateKey: "login" },
);
