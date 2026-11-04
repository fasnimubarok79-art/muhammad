import { describe, expect, it } from "vitest";
import { applyEnvAliases } from "@/lib/env-alias";

describe("CKP_ environment names", () => {
  it("CKP_ names fill and override the plain names; old names still work alone", () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: "test", CKP_SECRET_KEY: "new", SECRET_KEY: "old", STORAGE_DIR: "/legacy", CKP_APP_URL: "http://x" };
    applyEnvAliases(env);
    expect(env.SECRET_KEY).toBe("new");
    expect(env.APP_URL).toBe("http://x");
    expect(env.STORAGE_DIR).toBe("/legacy");
  });
  it("never rewrites DATABASE_URL and ignores empty values", () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: "test", DATABASE_URL: "postgres://keep", CKP_DATABASE_URL: "postgres://other", CKP_SMTP_URL: "", SMTP_URL: "smtp://old" };
    applyEnvAliases(env);
    expect(env.DATABASE_URL).toBe("postgres://keep");
    expect(env.SMTP_URL).toBe("smtp://old");
  });
});
