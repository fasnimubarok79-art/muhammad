import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ApiError, authedRoute, json, notFound, parseJson } from "@/lib/http";
import { idSchema } from "@/lib/validators";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("disable") }),
  z.object({ action: z.literal("enable") }),
  z.object({ action: z.literal("adjust_tokens"), amount: z.number().int().min(-100_000).max(100_000), reason: z.string().trim().min(3).max(200) }),
]);

/** Owner-only user management. There is deliberately no action that grants the admin role. */
export const POST = authedRoute<{ id: string }>(
  async ({ req, user, params, ip }) => {
    const targetId = idSchema.parse(params.id);
    const body = await parseJson(req, Body);
    const target = await db.user.findUnique({ where: { id: targetId } });
    if (!target) throw notFound("User");
    if (target.role === "OWNER_ADMIN") throw new ApiError(403, "FORBIDDEN", "Owner accounts are managed outside the app");
    if (body.action === "disable" || body.action === "enable") {
      await db.$transaction([
        db.user.update({ where: { id: target.id }, data: { disabledAt: body.action === "disable" ? new Date() : null } }),
        ...(body.action === "disable" ? [db.session.deleteMany({ where: { userId: target.id } })] : []),
      ]);
    } else {
      await db.$transaction(async (tx) => {
        const res = await tx.user.updateMany({ where: { id: target.id, tokenBalance: { gte: Math.max(0, -body.amount) } }, data: { tokenBalance: { increment: body.amount } } });
        if (!res.count) throw new ApiError(400, "NEGATIVE_BALANCE", "Balance cannot go below zero");
        const u = await tx.user.findUniqueOrThrow({ where: { id: target.id }, select: { tokenBalance: true } });
        await tx.tokenTransaction.create({ data: { userId: target.id, type: "ADJUST", amount: body.amount, balanceAfter: u.tokenBalance, reason: `Admin: ${body.reason}` } });
      });
    }
    await audit(`admin.${body.action}`, { userId: user.id, target: target.id, ip, meta: body.action === "adjust_tokens" ? { amount: body.amount } : undefined });
    return json({ ok: true });
  },
  { ownerOnly: true },
);
