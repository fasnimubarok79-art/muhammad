/**
 * Exercises the real yt-dlp argument list, output parsing and file placement against a local HTTP
 * server. The platform extractors are swapped for "generic" only here, because tests cannot reach
 * YouTube/TikTok/Instagram/Facebook. Skipped when yt-dlp is not installed for WHISPER_PYTHON.
 */
import { spawnSync, spawn } from "node:child_process";
import { createReadStream, existsSync, mkdtempSync, statSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildYtDlpArgs, parseYtDlpOutput, parseYtDlpProgress, ytDlpFriendlyError } from "@/lib/media/ytdlp";

const PY = process.env.WHISPER_PYTHON ?? "python3";
const VIDEO = process.env.TEST_VIDEO;
const hasYtDlp = spawnSync(PY, ["-I", "-m", "yt_dlp", "--version"]).status === 0;

describe("yt-dlp helpers", () => {
  it("never enables the generic extractor or cookies by default", () => {
    const a = buildYtDlpArgs({ url: "https://youtu.be/x", outBase: "/tmp/a/b", ffmpegPath: "ffmpeg", maxMb: 500, maxMinutes: 120, jsRuntime: "node" });
    expect(a[a.indexOf("--use-extractors") + 1]).toBe("youtube,tiktok,instagram,facebook");
    expect(a).toContain("--no-cookies");
    expect(a).toContain("--no-playlist");
    expect(a.join(" ")).toContain("!is_live");
    expect(a[a.length - 2]).toBe("--");
    expect(a).not.toContain("--cookies");
  });
  it("parses progress and rejects files written elsewhere", () => {
    expect(parseYtDlpProgress("PROGRESS  42.5%")).toBe(42.5);
    expect(() => parseYtDlpOutput('{"filepath":"/etc/passwd"}', "/tmp/x/base")).toThrow();
  });
  it("maps private/login errors to an upload suggestion", () => {
    expect(ytDlpFriendlyError("ERROR: [youtube] abc: Private video. Sign in")).toMatch(/private/i);
    expect(ytDlpFriendlyError("ERROR: [Instagram] x: login required")).toMatch(/login/i);
  });
});

describe.skipIf(!hasYtDlp || !VIDEO || !existsSync(VIDEO ?? ""))("yt-dlp real download (local server)", () => {
  let server: http.Server;
  let port = 0;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": String(statSync(VIDEO!).size) });
      createReadStream(VIDEO!).pipe(res);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => server.close());

  it("downloads, reports progress and prints the file path inside the target folder", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ytdlp-"));
    const outBase = path.join(dir, "source");
    const args = buildYtDlpArgs({ url: `http://127.0.0.1:${port}/talk.mp4`, outBase, ffmpegPath: process.env.FFMPEG_PATH ?? "ffmpeg", maxMb: 500, maxMinutes: 120, extractors: "generic" });
    let stdout = "";
    const progress: number[] = [];
    const code = await new Promise<number>((resolve) => {
      const p = spawn(PY, args);
      p.stdout.on("data", (b) => {
        stdout += b;
        String(b).split(/\r?\n/).forEach((l) => { const v = parseYtDlpProgress(l); if (v !== null) progress.push(v); });
      });
      p.stderr.on("data", (b) => String(b).split(/\r?\n/).forEach((l) => { const v = parseYtDlpProgress(l); if (v !== null) progress.push(v); }));
      p.on("close", (c) => resolve(c ?? 1));
    });
    expect(code).toBe(0);
    const r = parseYtDlpOutput(stdout, outBase);
    expect(existsSync(r.filepath)).toBe(true);
    expect(statSync(r.filepath).size).toBe(statSync(VIDEO!).size);
    expect(progress.length).toBeGreaterThan(0);
  }, 120_000);
});
