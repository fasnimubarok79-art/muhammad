import { z } from "zod";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { normaliseUsername, verifyPassword } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { ApiError, json, parseJson, publicRoute } from "@/lib/http";
import { RATE } from "@/lib/rate-limit";

// "login" is an email address or the owner username; "email" is accepted for older clients.
const Body = z
  .object({ login: z.string().trim().min(3).max(254).optional(), email: z.string().trim().min(3).max(254).optional(), password: z.string().min(1).max(200) })
  .refine((b) => b.login || b.email, { message: "Email or username is required" });
// Constant-cost dummy so unknown emails take as long as wrong passwords.
const DUMMY = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(86) + "==";

export const POST = publicRoute(
  async ({ req, ip }) => {
    const body = await parseJson(req, Body);
    const id = (body.login ?? body.email)!;
    const user = id.includes("@")
      ? await db.user.findUnique({ where: { email: id.toLowerCase() } })
      : await db.user.findUnique({ where: { username: normaliseUsername(id) } });
    const ok = await verifyPassword(body.password, user?.passwordHash ?? DUMMY);
    if (!user || !ok || user.disabledAt) {
      await audit("auth.login_failed", { userId: user?.id, ip, meta: { login: id.slice(0, 100) } });
      throw new ApiError(401, "BAD_CREDENTIALS", "Email/username or password is incorrect");
    }
    const { csrfToken } = await createSession(user.id, { ip, userAgent: req.headers.get("user-agent") ?? undefined });
    await audit("auth.login", { userId: user.id, ip });
    return json({ ok: true, csrfToken, mustChangePassword: user.mustChangePassword });
  },
  { rate: RATE.auth, rateKey: "login" },
);
