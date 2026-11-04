/**
 * ClipKita-Pro independent backup.
 *
 *   npm run backup                 (uses BACKUP_DIR, default: <project>/../CLIPKITA_BACKUP)
 *   npm run backup -- --with-tests (also runs typecheck + unit tests into 07_TEST_REPORT)
 *
 * Never changes the project or database. Never overwrites an existing backup. The database dump and
 * the media files (user data) are encrypted with AES-256-GCM using a key kept OUTSIDE the backup
 * folder (BACKUP_KEY_FILE, default: <project>/../CLIPKITA_BACKUP_KEY/backup.key).
 */
import "../../src/lib/env-alias";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { encryptFile, humanSize, listFiles, loadOrCreateKey, makeKeyCheck, log, pgEnv, pgTool, ROOT, run, sha256File, type Manifest } from "./common";

const CATEGORIES = ["01_SOURCE_CODE", "02_DATABASE", "03_ASSETS", "04_CONFIGURATION", "05_DOCUMENTATION", "06_DEPENDENCIES", "07_TEST_REPORT", "08_RECOVERY_TOOLS"] as const;
const EXCLUDED = [
  "node_modules/ (reinstall from package-lock.json)",
  ".next/ (build output, rebuilt with npm run build)",
  ".venv/ (reinstall from worker/stt/requirements.txt)",
  ".env (secrets; only variable NAMES are recorded in 04_CONFIGURATION)",
  "Whisper/OpenCV model caches (downloaded again on first use)",
  "untracked files not in git (listed under warnings when present)",
];

async function main() {
  const withTests = process.argv.includes("--with-tests");
  const backupRoot = path.resolve(process.env.BACKUP_DIR ?? path.join(ROOT, "..", "CLIPKITA_BACKUP"));
  const keyFile = path.resolve(process.env.BACKUP_KEY_FILE ?? path.join(ROOT, "..", "CLIPKITA_BACKUP_KEY", "backup.key"));
  if (keyFile.startsWith(backupRoot + path.sep)) throw new Error("BACKUP_KEY_FILE must not be inside BACKUP_DIR");

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const commit = (await run("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT })).trim();
  const version = `clipkita-pro-${stamp}-${commit}`;
  const dir = path.join(backupRoot, version);
  if (existsSync(dir)) throw new Error(`Backup ${dir} already exists; refusing to overwrite`);
  for (const c of CATEGORIES) await mkdir(path.join(dir, c), { recursive: true });
  const tmp = path.join(os.tmpdir(), `ckbk-${stamp}`);
  await mkdir(tmp, { recursive: true });
  const key = await loadOrCreateKey(keyFile, true);
  const warnings: string[] = [];
  log(`backup ${version} -> ${dir}`);

  // ---- 01 source code: exactly the committed tree
  const dirty = (await run("git", ["status", "--porcelain"], { cwd: ROOT })).split("\n").filter(Boolean);
  if (dirty.length) warnings.push(`Working tree has ${dirty.length} uncommitted change(s); the source archive contains commit ${commit} only.`);
  await run("git", ["archive", "--format=tar.gz", "-o", path.join(dir, "01_SOURCE_CODE", "source.tar.gz"), "HEAD"], { cwd: ROOT });
  await writeFile(path.join(dir, "01_SOURCE_CODE", "GIT_COMMIT.txt"), `${(await run("git", ["log", "-1", "--format=%H%n%an <%ae>%n%ad%n%s"], { cwd: ROOT })).trim()}\n\nUncommitted changes at backup time:\n${dirty.join("\n") || "(none)"}\n`);
  log("source: git archive done");

  // ---- 02 database: encrypted full dump + plain schema + migrations + row counts
  let database: Manifest["database"] = null;
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) warnings.push("DATABASE_URL is not set: database NOT backed up.");
  else {
    const env = pgEnv(dbUrl);
    const dumpPlain = path.join(tmp, "database.dump");
    await run(pgTool("pg_dump"), ["--format=custom", "--no-owner", "--no-privileges", "--file", dumpPlain], { env });
    await run(pgTool("pg_restore"), ["--list", dumpPlain], { env }); // proves the dump is readable
    await encryptFile(dumpPlain, path.join(dir, "02_DATABASE", "database.dump.enc"), key);
    await run(pgTool("pg_dump"), ["--schema-only", "--no-owner", "--no-privileges", "--file", path.join(dir, "02_DATABASE", "schema.sql")], { env });
    const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    const tables: Record<string, number> = {};
    try {
      const names = await db.$queryRaw<Array<{ tablename: string }>>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
      for (const { tablename } of names) {
        const r = await db.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT COUNT(*)::bigint AS n FROM "${tablename.replace(/"/g, "")}"`);
        tables[tablename] = Number(r[0].n);
      }
    } finally {
      await db.$disconnect();
    }
    const migrations = listFiles(path.join(ROOT, "prisma", "migrations")).filter((f) => f.endsWith("migration.sql")).map((f) => f.split("/")[0]);
    await run("tar", ["-czf", path.join(dir, "02_DATABASE", "prisma-migrations.tar.gz"), "-C", ROOT, "prisma"]);
    await writeFile(path.join(dir, "02_DATABASE", "ROW_COUNTS.json"), JSON.stringify(tables, null, 2));
    database = { name: env.PGDATABASE!, tables, migrations };
    await rm(dumpPlain, { force: true });
    log(`database: ${Object.keys(tables).length} tables, ${Object.values(tables).reduce((a, b) => a + b, 0)} rows, dump verified and encrypted`);
  }

  // ---- 03 assets: media storage (user videos, renders, thumbnails), encrypted
  let assets: Manifest["assets"] = null;
  const storage = process.env.STORAGE_DIR ? path.resolve(process.env.STORAGE_DIR) : null;
  if (!storage || !existsSync(storage)) warnings.push("STORAGE_DIR missing: media assets NOT backed up.");
  else {
    const files = listFiles(storage);
    let bytes = 0;
    for (const f of files) bytes += (await stat(path.join(storage, f))).size;
    const tarPlain = path.join(tmp, "storage.tar");
    await run("tar", ["-cf", tarPlain, "-C", storage, "."]);
    await encryptFile(tarPlain, path.join(dir, "03_ASSETS", "storage.tar.enc"), key);
    await rm(tarPlain, { force: true });
    await writeFile(path.join(dir, "03_ASSETS", "FILE_LIST.txt"), files.join("\n") + "\n");
    assets = { files: files.length, bytes };
    log(`assets: ${files.length} files (${humanSize(bytes)}) encrypted`);
  }

  // ---- 04 configuration: templates only, never secret values
  await copyFile(path.join(ROOT, ".env.example"), path.join(dir, "04_CONFIGURATION", ".env.example"));
  const envFile = path.join(ROOT, ".env");
  const names = existsSync(envFile) ? (await readFile(envFile, "utf8")).split(/\r?\n/).map((l) => l.match(/^([A-Z0-9_]+)=/)?.[1]).filter(Boolean) : [];
  await writeFile(path.join(dir, "04_CONFIGURATION", "ENV_VARIABLE_NAMES.txt"), `Variables set in the live .env (values intentionally NOT copied):\n${names.join("\n")}\n`);
  for (const f of ["next.config.mjs", "tailwind.config.ts", "tsconfig.json", "prisma/schema.prisma"]) await copyFile(path.join(ROOT, f), path.join(dir, "04_CONFIGURATION", f.replace("/", "_")));

  // ---- 05 documentation
  for (const f of ["README.md", "DESIGN.md", "CLAUDE.md", "docs/ROADMAP.md"]) if (existsSync(path.join(ROOT, f))) await copyFile(path.join(ROOT, f), path.join(dir, "05_DOCUMENTATION", path.basename(f)));

  // ---- 06 dependencies and runtime versions
  for (const f of ["package.json", "package-lock.json", "worker/stt/requirements.txt"]) await copyFile(path.join(ROOT, f), path.join(dir, "06_DEPENDENCIES", path.basename(f)));
  const runtime: Record<string, string> = { node: process.version, platform: `${process.platform} ${os.release()}` };
  const tryVer = async (label: string, bin: string, args: string[]) => {
    try {
      runtime[label] = (await run(bin, args)).split("\n")[0].trim();
    } catch {
      runtime[label] = "not found";
    }
  };
  const py = process.env.WHISPER_PYTHON ?? "python3";
  await tryVer("python", py, ["--version"]);
  await tryVer("ffmpeg", process.env.FFMPEG_PATH ?? "ffmpeg", ["-version"]);
  await tryVer("pg_dump", pgTool("pg_dump"), ["--version"]);
  try {
    await writeFile(path.join(dir, "06_DEPENDENCIES", "pip-freeze.txt"), await run(py, ["-m", "pip", "freeze"]));
  } catch {
    warnings.push("pip freeze failed: Python package versions not recorded.");
  }
  await writeFile(path.join(dir, "06_DEPENDENCIES", "RUNTIME_VERSIONS.json"), JSON.stringify(runtime, null, 2));

  // ---- 07 test report
  if (withTests) {
    log("running typecheck and unit tests (may take a few minutes)...");
    const report: string[] = [];
    // only checks that never write to the live database (DB and integration tests are excluded)
    const npx = process.platform === "win32" ? "npx.cmd" : "npx";
    const checks = [
      ["typecheck", ["tsc", "--noEmit"]],
      ["unit tests (no database)", ["vitest", "run", "--exclude", "tests/tokens.test.ts", "--exclude", "tests/*.integration.test.ts", "--exclude", "tests/e2e/**"]],
    ] as const;
    for (const [label, args] of checks) {
      try {
        const out = await run(npx, [...args], { cwd: ROOT, env: { TEST_VIDEO: "", FACE_VIDEO: "" } });
        report.push(`## ${label}: PASSED\n\n${out.slice(-4000)}`);
      } catch (e) {
        report.push(`## ${label}: FAILED\n\n${e instanceof Error ? e.message : e}`);
        warnings.push(`${label} failed at backup time.`);
      }
    }
    await writeFile(path.join(dir, "07_TEST_REPORT", "TEST_REPORT.md"), report.join("\n\n"));
  } else await writeFile(path.join(dir, "07_TEST_REPORT", "TEST_REPORT.md"), "Tests were not run during this backup (use --with-tests).\n");

  // ---- 08 recovery tools
  for (const f of ["common.ts", "restore.ts", "RECOVERY.md"]) await copyFile(path.join(ROOT, "scripts", "backup", f), path.join(dir, "08_RECOVERY_TOOLS", f));

  // ---- checksums and manifests
  const parts: Manifest["parts"] = [];
  for (const rel of listFiles(dir).sort()) {
    const full = path.join(dir, rel);
    parts.push({ path: rel, bytes: (await stat(full)).size, sha256: await sha256File(full), encrypted: rel.endsWith(".enc"), category: rel.split("/")[0] });
  }
  const manifest: Manifest = {
    version,
    createdAt: new Date().toISOString(),
    project: { root: ROOT, gitCommit: commit, gitDirty: dirty },
    runtime,
    database,
    assets,
    parts,
    excluded: EXCLUDED,
    warnings,
    keyCheck: makeKeyCheck(key),
  };
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  await writeFile(path.join(dir, "BACKUP_CHECKSUMS.txt"), parts.map((p) => `${p.sha256}  ${p.path}`).join("\n") + "\n");
  await writeFile(path.join(dir, "BACKUP_VERSION.txt"), `${version}\n`);
  const total = parts.reduce((a, p) => a + p.bytes, 0);
  await writeFile(
    path.join(dir, "BACKUP_MANIFEST.md"),
    [
      `# ClipKita-Pro backup ${version}`,
      "",
      `- Created: ${manifest.createdAt}`,
      `- Project: ${ROOT} (commit ${commit}${dirty.length ? `, ${dirty.length} uncommitted changes NOT included` : ""})`,
      `- Size: ${humanSize(total)} in ${parts.length} files`,
      `- Database: ${database ? `${database.name}, ${Object.keys(database.tables).length} tables, ${Object.values(database.tables).reduce((a, b) => a + b, 0)} rows (encrypted)` : "NOT backed up"}`,
      `- Assets: ${assets ? `${assets.files} files, ${humanSize(assets.bytes)} (encrypted)` : "NOT backed up"}`,
      `- Encryption key: kept outside this folder (not included). Without it 02_DATABASE and 03_ASSETS cannot be restored.`,
      "",
      "## Excluded",
      ...EXCLUDED.map((e) => `- ${e}`),
      "",
      "## Warnings",
      ...(warnings.length ? warnings.map((w) => `- ${w}`) : ["- none"]),
      "",
      "## Restore",
      "See 08_RECOVERY_TOOLS/RECOVERY.md. Restores go to a NEW folder and a NEW database; the live project is never touched.",
      "",
    ].join("\n"),
  );
  await rm(tmp, { recursive: true, force: true });
  log(`done: ${dir} (${humanSize(total)}, ${parts.length} files${warnings.length ? `, ${warnings.length} warning(s)` : ""})`);
  console.log(dir);
}

main().catch((e) => {
  console.error(`[backup] FAILED: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
