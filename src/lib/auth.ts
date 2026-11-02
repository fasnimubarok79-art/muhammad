import { cookies } from "next/headers";
import type { Role, User } from "@prisma/client";
import { db } from "./db";
import { randomToken, sha256 } from "./crypto";

export const SESSION_COOKIE = "ck_session";
const SESSION_DAYS = 14;

export type SessionUser = Pick<User, "id" | "email" | "name" | "role" | "mustChangePassword" | "tokenBalance">;

export async function createSession(userId: string, meta: { ip?: string; userAgent?: string }) {
  const raw = randomToken(32);
  const csrfToken = randomToken(24);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.session.create({
    data: { id: sha256(raw), userId, csrfToken, expiresAt, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 300) },
  });
  cookies().set(SESSION_COOKIE, raw, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  return { csrfToken };
}

export async function readSession(): Promise<{ user: SessionUser; csrfToken: string; sessionId: string } | null> {
  const raw = cookies().get(SESSION_COOKIE)?.value;
  if (!raw || raw.length > 200) return null;
  const session = await db.session.findUnique({
    where: { id: sha256(raw) },
    include: {
      user: { select: { id: true, email: true, name: true, role: true, mustChangePassword: true, tokenBalance: true, disabledAt: true } },
    },
  });
  if (!session || session.expiresAt < new Date() || session.user.disabledAt) return null;
  const { disabledAt: _d, ...user } = session.user;
  return { user, csrfToken: session.csrfToken, sessionId: session.id };
}

export async function destroySession() {
  const raw = cookies().get(SESSION_COOKIE)?.value;
  if (raw) await db.session.deleteMany({ where: { id: sha256(raw) } });
  cookies().delete(SESSION_COOKIE);
}

export function isOwner(user: { role: Role }) {
  return user.role === "OWNER_ADMIN";
}
