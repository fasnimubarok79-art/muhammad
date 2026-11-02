import path from "node:path";

/**
 * Only these yt-dlp extractors may run. The generic extractor is never enabled, so yt-dlp cannot be
 * pointed at arbitrary hosts (SSRF); arbitrary direct links go through safeRequest instead.
 */
export const SOCIAL_EXTRACTORS = "youtube,tiktok,instagram,facebook";
export const SOCIAL_PLATFORMS = new Set(["youtube", "tiktok", "instagram", "facebook"]);

export type YtDlpOptions = {
  url: string;
  outBase: string; // absolute path without extension
  ffmpegPath: string;
  maxMb: number;
  maxMinutes: number;
  extractors?: string; // tests only
  jsRuntime?: string; // e.g. "node" (YouTube needs a JS runtime)
};

/**
 * Public videos only: no cookies, no browser cookies, no login, no live streams, no playlists.
 * Prints one JSON line with the fields we need after the file is in place.
 */
export function buildYtDlpArgs(o: YtDlpOptions): string[] {
  const args = [
    "-I", "-m", "yt_dlp",
    "--ignore-config",
    "--no-playlist",
    "--use-extractors", o.extractors ?? SOCIAL_EXTRACTORS,
    "--match-filters", `!is_live & duration <? ${Math.round(o.maxMinutes * 60)}`,
    "--max-filesize", `${o.maxMb}M`,
    "-f", "bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b",
    "--merge-output-format", "mp4",
    "--ffmpeg-location", o.ffmpegPath,
    "--socket-timeout", "30",
    "--retries", "3",
    "--no-part",
    "--no-mtime",
    "--no-cookies",
    "--no-cookies-from-browser",
    "-o", `${o.outBase}.%(ext)s`,
    "--no-simulate",
    "--print", "after_move:%(.{title,duration,uploader,filepath,width,height})j",
    "--progress", "--newline",
    "--progress-template", "download:PROGRESS %(progress._percent_str)s",
  ];
  if (o.jsRuntime) args.push("--js-runtimes", o.jsRuntime);
  args.push("--", o.url);
  return args;
}

export type YtDlpResult = { title?: string; duration?: number; uploader?: string; filepath: string; width?: number; height?: number };

/** Find the JSON line printed after the move; ignore progress and other output. */
export function parseYtDlpOutput(stdout: string, outBase: string): YtDlpResult {
  const line = stdout.split(/\r?\n/).reverse().find((l) => l.trim().startsWith("{"));
  if (!line) throw new Error("yt-dlp did not report a file");
  const data = JSON.parse(line) as YtDlpResult;
  const dir = path.resolve(path.dirname(outBase));
  const file = path.resolve(data.filepath ?? "");
  if (!file.startsWith(dir + path.sep) || !path.basename(file).startsWith(path.basename(outBase))) {
    throw new Error("yt-dlp wrote outside the expected location");
  }
  return { ...data, filepath: file };
}

export function parseYtDlpProgress(line: string): number | null {
  const m = line.match(/PROGRESS\s+([\d.]+)%/);
  return m ? Number(m[1]) : null;
}

/** Turn yt-dlp errors into messages a user can act on. Never suggests bypassing restrictions. */
export function ytDlpFriendlyError(stderr: string): string {
  const s = stderr.toLowerCase();
  if (s.includes("private video") || s.includes("this video is private")) return "This video is private. Only public videos can be imported; upload the original file instead.";
  if (s.includes("sign in") || s.includes("login") || s.includes("log in") || s.includes("cookies")) return "The platform requires a login for this video, so it cannot be imported. Upload the original file instead.";
  if (s.includes("is_live") || s.includes("live event") || s.includes("is live")) return "Live streams cannot be imported. Try again after the stream has ended.";
  if (s.includes("does not pass filter") && s.includes("duration")) return "The video is longer than the allowed maximum.";
  if (s.includes("max-filesize") || s.includes("larger than max")) return "The video file is larger than the allowed maximum.";
  if (s.includes("drm")) return "This video is DRM-protected and cannot be imported.";
  if (s.includes("unavailable") || s.includes("not available") || s.includes("removed")) return "The video is unavailable (removed, region-locked or restricted).";
  if (s.includes("no suitable extractor") || s.includes("unsupported url")) return "This link type is not supported.";
  if (s.includes("unable to download") || s.includes("timed out") || s.includes("connection")) return "The platform could not be reached. Check the internet connection and try again.";
  return "The video could not be fetched from the platform. Upload the original file instead.";
}
