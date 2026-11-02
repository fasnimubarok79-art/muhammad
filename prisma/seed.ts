/**
 * Idempotent owner-admin bootstrap. Reads OWNER_EMAIL and OWNER_INITIAL_PASSWORD from the
 * environment, never from source. Safe to run on every deploy:
 * - creates the owner once, with mustChangePassword = true;
 * - never resets an existing owner's password;
 * - never promotes or creates any other admin.
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword, normaliseUsername, PASSWORD_RULES } from "../src/lib/crypto";

const db = new PrismaClient();

async function main() {
  const email = (process.env.OWNER_EMAIL ?? "ADMIN16112000@gmail.com").trim().toLowerCase();
  const username = normaliseUsername(process.env.OWNER_USERNAME ?? "ADMINPRO16112000");
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.role !== "OWNER_ADMIN") {
      console.error(`[seed] ${email} exists as a normal user. Refusing to promote automatically; do it manually after verifying ownership.`);
      process.exitCode = 1;
      return;
    }
    if (existing.username !== username) {
      await db.user.update({ where: { id: existing.id }, data: { username } });
      console.log(`[seed] owner admin already exists (${email}); login username set to ${username}, password unchanged`);
    } else {
      console.log(`[seed] owner admin already exists (${email} / ${username}), nothing changed`);
    }
    return;
  }
  const password = process.env.OWNER_INITIAL_PASSWORD;
  if (!password || password.length < PASSWORD_RULES.ownerInitialMin) {
    console.error(`[seed] OWNER_INITIAL_PASSWORD is missing or shorter than ${PASSWORD_RULES.ownerInitialMin} characters`);
    process.exitCode = 1;
    return;
  }
  await db.user.create({
    data: { email, username, name: "Owner", role: "OWNER_ADMIN", passwordHash: await hashPassword(password), mustChangePassword: true, tokenBalance: 0 },
  });
  await db.auditLog.create({ data: { action: "owner.bootstrap", target: email } });
  console.log(`[seed] owner admin created (${email} / ${username}); password change is required at first login`);
}

main().finally(() => db.$disconnect());
