import { Prisma, type Role } from "@prisma/client";
import { db } from "./db";
import { ApiError } from "./http";

export const TOKEN_COST = {
  SIGNUP_GRANT: 500,
  EDIT_JOB: 5,
  DOWNLOAD: 10,
  EXPORT_1080: 400,
} as const;

export type Resolution = "450p" | "720p" | "1080p";

/** Price shown to the user before confirming a render. 450p and 720p have no surcharge. */
export function renderCost(resolution: Resolution, role: Role) {
  const lines: Array<{ label: string; amount: number }> = [{ label: "Editing job", amount: TOKEN_COST.EDIT_JOB }];
  if (resolution === "1080p") lines.push({ label: "Export 1080p", amount: TOKEN_COST.EXPORT_1080 });
  const total = lines.reduce((s, l) => s + l.amount, 0);
  return { lines, total, charged: role === "OWNER_ADMIN" ? 0 : total, unlimited: role === "OWNER_ADMIN" };
}

export function downloadCost(role: Role) {
  return { total: TOKEN_COST.DOWNLOAD, charged: role === "OWNER_ADMIN" ? 0 : TOKEN_COST.DOWNLOAD, unlimited: role === "OWNER_ADMIN" };
}

type Tx = Prisma.TransactionClient;

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/** One-time signup grant. Safe to call repeatedly: signupGrantedAt + idempotency key guard it. */
export async function grantSignup(tx: Tx, userId: string) {
  const updated = await tx.user.updateMany({
    where: { id: userId, signupGrantedAt: null, role: "USER" },
    data: { signupGrantedAt: new Date(), tokenBalance: { increment: TOKEN_COST.SIGNUP_GRANT } },
  });
  if (updated.count === 0) return false;
  const u = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { tokenBalance: true } });
  await tx.tokenTransaction.create({
    data: { userId, type: "GRANT", amount: TOKEN_COST.SIGNUP_GRANT, balanceAfter: u.tokenBalance, reason: "Signup balance", idempotencyKey: "signup" },
  });
  return true;
}

/**
 * Atomically take `amount` from the balance. The conditional UPDATE makes overspending impossible
 * even under concurrency. Owner admin is never charged (recorded as a zero-amount entry for audit).
 */
export async function reserve(tx: Tx, user: { id: string; role: Role }, amount: number, reason: string, refId: string, idempotencyKey: string, type: "RESERVE" | "CHARGE" = "RESERVE") {
  if (user.role === "OWNER_ADMIN" || amount === 0) {
    const u = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { tokenBalance: true } });
    await tx.tokenTransaction.create({ data: { userId: user.id, type, amount: 0, balanceAfter: u.tokenBalance, reason: `${reason} (unlimited)`, refId, idempotencyKey } });
    return;
  }
  const res = await tx.user.updateMany({ where: { id: user.id, tokenBalance: { gte: amount } }, data: { tokenBalance: { decrement: amount } } });
  if (res.count === 0) {
    const u = await tx.user.findUnique({ where: { id: user.id }, select: { tokenBalance: true } });
    throw new ApiError(402, "INSUFFICIENT_TOKENS", "Not enough tokens", { required: amount, balance: u?.tokenBalance ?? 0 });
  }
  const u = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { tokenBalance: true } });
  await tx.tokenTransaction.create({ data: { userId: user.id, type, amount: -amount, balanceAfter: u.tokenBalance, reason, refId, idempotencyKey } });
}

/** Mark a reservation as final once the job succeeded. */
export async function capture(tx: Tx, userId: string, jobId: string) {
  const r = await tx.tokenTransaction.findFirst({ where: { userId, refId: jobId, type: "RESERVE" } });
  if (!r) return;
  try {
    await tx.tokenTransaction.create({
      data: { userId, type: "CAPTURE", amount: 0, balanceAfter: r.balanceAfter, reason: "Job completed", refId: jobId, idempotencyKey: `capture:${jobId}` },
    });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
  }
}

/** Return reserved tokens when a job fails or is cancelled. Idempotent per job. */
export async function refund(userId: string, jobId: string, why: string) {
  return db.$transaction(async (tx) => {
    const r = await tx.tokenTransaction.findFirst({ where: { userId, refId: jobId, type: "RESERVE" } });
    if (!r || r.amount === 0) return 0;
    const already = await tx.tokenTransaction.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: `refund:${jobId}` } } });
    if (already) return 0;
    const amount = -r.amount;
    const u = await tx.user.update({ where: { id: userId }, data: { tokenBalance: { increment: amount } }, select: { tokenBalance: true } });
    await tx.tokenTransaction.create({
      data: { userId, type: "REFUND", amount, balanceAfter: u.tokenBalance, reason: `Refund: ${why}`.slice(0, 200), refId: jobId, idempotencyKey: `refund:${jobId}` },
    });
    return amount;
  });
}

/** Charge a download once per rendered file; repeat downloads of the same file are free. */
export async function chargeDownload(user: { id: string; role: Role }, renderJobId: string) {
  return db.$transaction(async (tx) => {
    const key = `download:${renderJobId}`;
    const existing = await tx.tokenTransaction.findUnique({ where: { userId_idempotencyKey: { userId: user.id, idempotencyKey: key } } });
    if (existing) return { charged: 0, alreadyPaid: true };
    const cost = downloadCost(user.role).charged;
    try {
      await reserve(tx, user, cost, "Download rendered video", renderJobId, key, "CHARGE");
    } catch (e) {
      if (isUniqueViolation(e)) return { charged: 0, alreadyPaid: true };
      throw e;
    }
    return { charged: cost, alreadyPaid: false };
  });
}
