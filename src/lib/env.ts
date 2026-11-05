import "./env-alias";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url(),
  STORAGE_DIR: z.string().min(1),
  SECRET_KEY: z.string().min(32, "SECRET_KEY must be at least 32 chars"),
  OWNER_EMAIL: z.string().email().default("ADMIN16112000@gmail.com"),
  OWNER_INITIAL_PASSWORD: z.string().optional(),
  OWNER_NAME: z.string().max(80).optional(),
  OWNER_USERNAME: z.string().regex(/^[A-Za-z0-9_.-]{3,40}$/).default("ADMINPRO16112000"),
  WHISPER_MODEL: z.string().default("small"),
  WHISPER_PYTHON: z.string().default("python3"),
  WHISPER_LANGUAGE: z.string().optional(),
  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(500),
  MAX_SOURCE_MINUTES: z.coerce.number().positive().default(120),
  JOB_TIMEOUT_MIN: z.coerce.number().positive().default(60),
  META_APP_TOKEN: z.string().optional(),
  // Fetch public YouTube/TikTok/Instagram/Facebook videos with yt-dlp ("0" turns it off).
  LINK_IMPORT: z.enum(["0", "1"]).default("1"),
  YTDLP_PYTHON: z.string().optional(), // defaults to WHISPER_PYTHON
  YTDLP_JS_RUNTIME: z.string().default("node"), // YouTube needs a JS runtime; "" disables
  SMTP_URL: z.string().optional(),
  // Optional Gemini API key for AI-generated hooks, titles and semantic word highlighting.
  GEMINI_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Validated server environment. Throws a readable error naming only the missing keys, never values. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const keys = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid server configuration: ${keys}`);
  }
  cached = parsed.data;
  return cached;
}
