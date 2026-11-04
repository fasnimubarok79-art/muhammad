/**
 * ClipKita-Pro restore / recovery test. Never touches the live project or database.
 *
 *   npm run backup:restore -- --from <backup folder> --verify-only
 *   npm run backup:restore -- --from <backup folder> --to <new empty folder> [--db <new database name>]
 *
 * Needs: the backup key file (BACKUP_KEY_FILE), DATABASE_URL credentials of a role that may create
 * databases (the new database is created next to the live one with a different name), git-free tar.
 */
import "../../src/lib/env-alias";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { decryptFile, keyMatches, listFiles, loadOrCreateKey, log, pgEnv, pgTool, ROOT, run, sha256File, type Manifest } from "./common";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const from = arg("from");
  if (!from) throw new Error("Usage: --from <backup folder> [--to <new folder>] [--db <name>] [--verify-only]");
  const dir = path.resolve(from);
  const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as Manifest;
  const report: string[] = [`# Restore report for ${manifest.version}`, "", `- Started: ${new Date().toISOString()}`];

  // 1. integrity: every file listed must exist with the same size and checksum
  let bad = 0;
  for (const p of manifest.parts) {
    const full = path.join(dir, p.path);
    if (!existsSync(full)) {
      bad++;
      log(`MISSING ${p.path}`);
    } else if ((await sha256File(full)) !== p.sha256) {
      bad++;
      log(`CHECKSUM MISMATCH ${p.path}`);
    }
  }
  const extra = listFiles(dir).filter((f) => !["manifest.json", "BACKUP_CHECKSUMS.txt", "BACKUP_VERSION.txt", "BACKUP_MANIFEST.md"].includes(f) && !manifest.parts.some((p) => p.path === f));
  if (bad) throw new Error(`${bad} file(s) missing or corrupted; restore aborted`);
  log(`checksums OK for ${manifest.parts.length} files${extra.length ? ` (${extra.length} extra files ignored)` : ""}`);
  report.push(`- Checksums: OK (${manifest.parts.length} files)`);
  if (process.argv.includes("--verify-only")) {
    console.log("VERIFY OK");
    return;
  }

  const to = arg("to");
  if (!to) throw new Error("--to <new empty folder> is required for a restore");
  const target = path.resolve(to);
  if (target === ROOT || ROOT.startsWith(target + path.sep)) throw new Error("Refusing to restore into the live project");
  if (existsSync(target) && readdirSync(target).length) throw new Error(`${target} is not empty; choose a new folder`);
  const key = await loadOrCreateKey(path.resolve(process.env.BACKUP_KEY_FILE ?? path.join(ROOT, "..", "CLIPKITA_BACKUP_KEY", "backup.key")), false);
  if (manifest.keyCheck && !keyMatches(manifest.keyCheck, key)) throw new Error("The backup key does not match this backup (BACKUP_KEY_FILE); nothing was restored");
  // validate the database target BEFORE writing anything, so a refusal leaves no partial restore behind
  const dbName = arg("db") ?? `clipkita_restore_${Date.now()}`;
  if (manifest.database) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is needed to create the restore database");
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(dbName)) throw new Error("Database name must be lower-case letters, digits and _");
    if (dbName === new URL(process.env.DATABASE_URL).pathname.replace(/^\//, "")) throw new Error("Refusing to restore over the live database");
    const exists = (await run(pgTool("psql"), ["-tAc", `SELECT 1 FROM pg_database WHERE datname='${dbName}'`], { env: pgEnv(process.env.DATABASE_URL, "postgres") })).trim();
    if (exists === "1") throw new Error(`Database ${dbName} already exists; choose another name`);
  }
  await mkdir(target, { recursive: true });
  const tmp = path.join(os.tmpdir(), `ckrs-${Date.now()}`);
  await mkdir(tmp, { recursive: true });

  // 2. source code
  await run("tar", ["-xzf", path.join(dir, "01_SOURCE_CODE", "source.tar.gz"), "-C", target]);
  const restoredFiles = listFiles(target).length;
  log(`source extracted: ${restoredFiles} files`);
  report.push(`- Source: ${restoredFiles} files extracted (commit ${manifest.project.gitCommit})`);

  // 3. database into a NEW database
  if (manifest.database) {
    const url = process.env.DATABASE_URL!;
    const admin = pgEnv(url, "postgres");
    await run(pgTool("psql"), ["-qc", `CREATE DATABASE "${dbName}"`], { env: admin });
    const dump = path.join(tmp, "database.dump");
    await decryptFile(path.join(dir, "02_DATABASE", "database.dump.enc"), dump, key);
    await run(pgTool("pg_restore"), ["--no-owner", "--no-privileges", "--exit-on-error", "-d", dbName, dump], { env: pgEnv(url, dbName) });
    await rm(dump, { force: true });
    // compare row counts with the manifest
    const mismatches: string[] = [];
    for (const [t, n] of Object.entries(manifest.database.tables)) {
      const got = Number((await run(pgTool("psql"), ["-tAc", `SELECT COUNT(*) FROM "${t.replace(/"/g, "")}"`], { env: pgEnv(url, dbName) })).trim());
      if (got !== n) mismatches.push(`${t}: expected ${n}, got ${got}`);
    }
    if (mismatches.length) throw new Error(`Row counts differ after restore:\n${mismatches.join("\n")}`);
    const restoredUrl = new URL(url);
    restoredUrl.pathname = `/${dbName}`;
    await writeFile(path.join(target, ".env.restore"), `# Generated by restore.ts. Copy into .env with your own secrets for this recovery copy.\nDATABASE_URL=${restoredUrl.toString()}\nSTORAGE_DIR=${path.join(target, "storage").split(path.sep).join("/")}\n`, { mode: 0o600 });
    log(`database restored into ${dbName}; row counts match for ${Object.keys(manifest.database.tables).length} tables`);
    report.push(`- Database: restored into NEW database \`${dbName}\`; row counts match (${Object.keys(manifest.database.tables).length} tables)`);
  } else report.push("- Database: not part of this backup");

  // 4. media assets
  if (manifest.assets) {
    const tarFile = path.join(tmp, "storage.tar");
    await decryptFile(path.join(dir, "03_ASSETS", "storage.tar.enc"), tarFile, key);
    await mkdir(path.join(target, "storage"), { recursive: true });
    await run("tar", ["-xf", tarFile, "-C", path.join(target, "storage")]);
    await rm(tarFile, { force: true });
    const n = listFiles(path.join(target, "storage")).length;
    if (n !== manifest.assets.files) throw new Error(`Assets: expected ${manifest.assets.files} files, restored ${n}`);
    log(`assets restored: ${n} files`);
    report.push(`- Assets: ${n} files restored into storage/ (matches manifest)`);
  }

  await rm(tmp, { recursive: true, force: true });
  report.push(`- Finished: ${new Date().toISOString()}`, "", "Next: copy .env.restore values into a .env (add SECRET_KEY and other secrets), run `npm ci`, `npm run build`, then start the app from this folder.");
  await writeFile(path.join(target, "RESTORE_REPORT.md"), report.join("\n") + "\n");
  console.log(`RESTORE OK -> ${target}`);
}

main().catch((e) => {
  console.error(`[restore] FAILED: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
