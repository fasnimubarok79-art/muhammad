import type { Prisma } from "@prisma/client";
import { db } from "./db";

/** Never put secrets, tokens or passwords in meta. */
export async function audit(
  action: string,
  opts: { userId?: string | null; target?: string; meta?: Prisma.InputJsonValue; ip?: string } = {},
  tx: Prisma.TransactionClient = db,
) {
  await tx.auditLog.create({ data: { action, userId: opts.userId ?? null, target: opts.target, meta: opts.meta, ip: opts.ip } });
}
