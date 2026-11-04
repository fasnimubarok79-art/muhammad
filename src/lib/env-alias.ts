/**
 * ClipKita-Pro environment names use the CKP_ prefix (CKP_SECRET_KEY, CKP_STORAGE_DIR, ...).
 * Older installs use the unprefixed names, which keep working. When both exist, CKP_ wins.
 * DATABASE_URL stays unprefixed on purpose: Prisma and the PostgreSQL tools read that exact name.
 * Imported for its side effect at the start of every entry point.
 */
const PREFIX = "CKP_";

export function applyEnvAliases(env: NodeJS.ProcessEnv = process.env) {
  for (const key of Object.keys(env)) {
    if (key.startsWith(PREFIX) && key.length > PREFIX.length) {
      const plain = key.slice(PREFIX.length);
      if (plain !== "DATABASE_URL" && env[key] !== undefined && env[key] !== "") env[plain] = env[key];
    }
  }
}

applyEnvAliases();
