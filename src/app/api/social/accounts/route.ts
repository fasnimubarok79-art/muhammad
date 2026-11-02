import { db } from "@/lib/db";
import { authedRoute, json } from "@/lib/http";

/** Tokens are never returned to the client. */
export const GET = authedRoute(async ({ user }) => {
  const accounts = await db.socialAccount.findMany({
    where: { userId: user.id },
    select: { id: true, platform: true, displayName: true, scopes: true, expiresAt: true, createdAt: true },
  });
  return json({ accounts });
});
