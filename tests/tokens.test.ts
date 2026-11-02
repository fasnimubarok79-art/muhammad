import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { chargeDownload, grantSignup, refund, renderCost, reserve, TOKEN_COST } from "@/lib/tokens";

const stamp = Date.now();
let user = { id: "", role: "USER" as const };
let owner = { id: "", role: "OWNER_ADMIN" as const };

beforeAll(async () => {
  user.id = (await db.user.create({ data: { email: `tok-${stamp}@test.local`, passwordHash: "x" } })).id;
  owner.id = (await db.user.create({ data: { email: `own-${stamp}@test.local`, passwordHash: "x", role: "OWNER_ADMIN" } })).id;
});
afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [user.id, owner.id] } } });
  await db.$disconnect();
});

const balance = async (id: string) => (await db.user.findUniqueOrThrow({ where: { id } })).tokenBalance;

describe("token ledger", () => {
  it("prices: 5 per edit job, +400 for 1080p, owner charged 0", () => {
    expect(renderCost("720p", "USER").charged).toBe(5);
    expect(renderCost("450p", "USER").charged).toBe(5);
    expect(renderCost("1080p", "USER").charged).toBe(405);
    expect(renderCost("1080p", "OWNER_ADMIN").charged).toBe(0);
    expect(TOKEN_COST.DOWNLOAD).toBe(10);
  });

  it("signup grant of 500 happens exactly once", async () => {
    const results = await Promise.all([1, 2, 3].map(() => db.$transaction((tx) => grantSignup(tx, user.id)).catch(() => false)));
    expect(results.filter(Boolean).length).toBe(1);
    expect(await balance(user.id)).toBe(500);
  });

  it("concurrent reservations can never overspend", async () => {
    // 500 tokens, 3 concurrent 405-token renders: exactly one may succeed
    const attempts = await Promise.allSettled([1, 2, 3].map((i) => db.$transaction((tx) => reserve(tx, user, 405, "render", `job-c${i}-${stamp}`, `render:c${i}-${stamp}`))));
    expect(attempts.filter((a) => a.status === "fulfilled").length).toBe(1);
    expect(await balance(user.id)).toBe(95);
  });

  it("refund returns tokens once, even if called twice", async () => {
    const tx = await db.tokenTransaction.findFirstOrThrow({ where: { userId: user.id, type: "RESERVE" } });
    expect(await refund(user.id, tx.refId!, "failed")).toBe(405);
    expect(await refund(user.id, tx.refId!, "failed again")).toBe(0);
    expect(await balance(user.id)).toBe(500);
  });

  it("the same idempotency key cannot charge twice", async () => {
    await db.$transaction((tx) => reserve(tx, user, 5, "render", `job-i-${stamp}`, `render:same-${stamp}`));
    await expect(db.$transaction((tx) => reserve(tx, user, 5, "render", `job-i2-${stamp}`, `render:same-${stamp}`))).rejects.toThrow();
    expect(await balance(user.id)).toBe(495);
  });

  it("download is charged 10 once per file; repeats are free", async () => {
    const a = await chargeDownload(user, `render-x-${stamp}`);
    const b = await chargeDownload(user, `render-x-${stamp}`);
    expect(a.charged).toBe(10);
    expect(b).toEqual({ charged: 0, alreadyPaid: true });
    expect(await balance(user.id)).toBe(485);
  });

  it("insufficient balance is rejected with 402", async () => {
    await expect(db.$transaction((tx) => reserve(tx, user, 10_000, "render", `job-big-${stamp}`, `render:big-${stamp}`))).rejects.toMatchObject({ status: 402, code: "INSUFFICIENT_TOKENS" });
  });

  it("owner admin is unlimited: never charged, balance unchanged", async () => {
    const before = await balance(owner.id);
    await db.$transaction((tx) => reserve(tx, owner, 405, "render", `job-o-${stamp}`, `render:o-${stamp}`));
    await chargeDownload(owner, `render-o-${stamp}`);
    expect(await balance(owner.id)).toBe(before);
    expect(await db.$transaction((tx) => grantSignup(tx, owner.id))).toBe(false);
  });
});
