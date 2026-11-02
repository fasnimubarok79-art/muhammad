import { z } from "zod";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { hashPassword } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { ApiError, json, parseJson, publicRoute } from "@/lib/http";
import { RATE } from "@/lib/rate-limit";
import { grantSignup } from "@/lib/tokens";
import { emailSchema, passwordSchema } from "@/lib/validators";
import { env } from "@/lib/env";

const Body = z.object({ email: emailSchema, password: passwordSchema, name: z.string().trim().max(80).optional() });

export const POST = publicRoute(
  async ({ req, ip }) => {
    const body = await parseJson(req, Body);
    if (body.email === env().OWNER_EMAIL.toLowerCase()) throw new ApiError(409, "EMAIL_TAKEN", "This email cannot be registered");
    const exists = await db.user.findUnique({ where: { email: body.email }, select: { id: true } });
    if (exists) throw new ApiError(409, "EMAIL_TAKEN", "An account with this email already exists");
    const passwordHash = await hashPassword(body.password);
    const user = await db.$transaction(async (tx) => {
      const u = await tx.user.create({ data: { email: body.email, name: body.name, passwordHash, role: "USER" } });
      await grantSignup(tx, u.id);
      await audit("user.register", { userId: u.id, ip }, tx);
      return u;
    });
    const { csrfToken } = await createSession(user.id, { ip, userAgent: req.headers.get("user-agent") ?? undefined });
    return json({ ok: true, csrfToken }, 201);
  },
  { rate: RATE.auth, rateKey: "register" },
);
