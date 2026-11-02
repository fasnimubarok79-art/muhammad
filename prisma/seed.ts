/**
 * Idempotent owner-admin bootstrap. Reads OWNER_EMAIL and OWNER_INITIAL_PASSWORD from the
 * environment, never from source. Safe to run on every deploy:
 * - creates the owner once, with mustChangePassword = true;
 * - never resets an existing owner's password;
 * - never promotes or creates any other admin.
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword, PASSWORD_RULES } from "../src/lib/crypto";

const db = new PrismaClient();

async function main() {
  const email = (process.env.OWNER_EMAIL ?? "ADMIN16112000@gmail.com").trim().toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.role !== "OWNER_ADMIN") {
      console.error(`[seed] ${email} exists as a normal user. Refusing to promote automatically; do it manually after verifying ownership.`);
      process.exitCode = 1;
      return;
    }
    console.log(`[seed] owner admin already exists (${email}), nothing changed`);
    return;
  }
  const password = process.env.OWNER_INITIAL_PASSWORD;
  if (!password || password.length < PASSWORD_RULES.min) {
    console.error(`[seed] OWNER_INITIAL_PASSWORD is missing or shorter than ${PASSWORD_RULES.min} characters`);
    process.exitCode = 1;
    return;
  }
  await db.user.create({
    data: { email, name: "Owner", role: "OWNER_ADMIN", passwordHash: await hashPassword(password), mustChangePassword: true, tokenBalance: 0 },
  });
  await db.auditLog.create({ data: { action: "owner.bootstrap", target: email } });
  console.log(`[seed] owner admin created (${email}); password change is required at first login`);
}

main().finally(() => db.$disconnect());
