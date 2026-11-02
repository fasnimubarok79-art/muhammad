import { db } from "@/lib/db";
import { authedRoute, json } from "@/lib/http";
import { TOKEN_COST } from "@/lib/tokens";

export const GET = authedRoute(async ({ user }) => {
  const txs = await db.tokenTransaction.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 });
  return json({ balance: user.tokenBalance, unlimited: user.role === "OWNER_ADMIN", prices: TOKEN_COST, transactions: txs.map(({ idempotencyKey: _k, ...t }) => t) });
});
