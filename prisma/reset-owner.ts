/**
 * Local recovery: reset the owner admin password to OWNER_INITIAL_PASSWORD from .env.
 * Only someone with access to the server's .env and database can run this.
 *   npm run owner:reset
 * The owner must change the password again at the next login, and all owner sessions are signed out.
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword, PASSWORD_RULES } from "../src/lib/crypto";

const db = new PrismaClient();

async function main() {
  const email = (process.env.OWNER_EMAIL ?? "ADMIN16112000@gmail.com").trim().toLowerCase();
  const password = process.env.OWNER_INITIAL_PASSWORD ?? "";
  if (password.length < PASSWORD_RULES.min) {
    console.error(`[owner:reset] OWNER_INITIAL_PASSWORD in .env is missing or shorter than ${PASSWORD_RULES.min} characters`);
    process.exitCode = 1;
    return;
  }
  const owner = await db.user.findUnique({ where: { email } });
  if (!owner) {
    console.error(`[owner:reset] No account for ${email}. Run: npm run db:seed`);
    process.exitCode = 1;
    return;
  }
  if (owner.role !== "OWNER_ADMIN") {
    console.error(`[owner:reset] ${email} is not the owner admin; refusing to change it`);
    process.exitCode = 1;
    return;
  }
  await db.$transaction([
    db.user.update({ where: { id: owner.id }, data: { passwordHash: await hashPassword(password), mustChangePassword: true, disabledAt: null } }),
    db.session.deleteMany({ where: { userId: owner.id } }),
    db.auditLog.create({ data: { action: "owner.password_reset_cli", userId: owner.id, target: email } }),
  ]);
  console.log(`[owner:reset] Password for ${email} is now the OWNER_INITIAL_PASSWORD value in .env.`);
  console.log("[owner:reset] Log in with it; you will be asked to choose a new password.");
}

main().finally(() => db.$disconnect());
