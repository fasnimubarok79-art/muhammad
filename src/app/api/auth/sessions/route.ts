import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { readSession } from "@/lib/auth";
import { authedRoute, json } from "@/lib/http";

/** Sign out every other device; the current session stays. */
export const DELETE = authedRoute(
  async ({ user, ip }) => {
    const current = await readSession();
    const r = await db.session.deleteMany({ where: { userId: user.id, NOT: { id: current?.sessionId } } });
    await audit("auth.sessions_revoked", { userId: user.id, ip, meta: { count: r.count } });
    return json({ ok: true, signedOut: r.count });
  },
  { allowPasswordChange: true },
);

export const GET = authedRoute(async ({ user }) => {
  const current = await readSession();
  const sessions = await db.session.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, select: { id: true, createdAt: true, userAgent: true, expiresAt: true } });
  return json({ sessions: sessions.map((s) => ({ current: s.id === current?.sessionId, createdAt: s.createdAt, expiresAt: s.expiresAt, device: s.userAgent?.slice(0, 120) ?? null })) });
});
