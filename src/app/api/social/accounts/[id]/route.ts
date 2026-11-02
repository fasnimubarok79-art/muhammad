import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { authedRoute, json, notFound } from "@/lib/http";
import { idSchema } from "@/lib/validators";

/** Disconnect: deletes the encrypted tokens. Revoke access in the platform's settings as well. */
export const DELETE = authedRoute<{ id: string }>(async ({ user, params, ip }) => {
  const r = await db.socialAccount.deleteMany({ where: { id: idSchema.parse(params.id), userId: user.id } });
  if (!r.count) throw notFound("Account");
  await audit("social.disconnect", { userId: user.id, target: params.id, ip });
  return json({ ok: true });
});
