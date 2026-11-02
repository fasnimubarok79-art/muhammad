import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { ApiError } from "./http";

/** Stream a protected file with HTTP Range support (needed for seeking in <video>). */
export async function streamFile(req: NextRequest, file: string, contentType: string, download?: string) {
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    throw new ApiError(404, "NOT_FOUND", "Media not found");
  }
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": download ? `attachment; filename*=UTF-8''${encodeURIComponent(download)}` : "inline",
  };
  const range = req.headers.get("range");
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    }
    const body = Readable.toWeb(createReadStream(file, { start, end })) as unknown as ReadableStream;
    return new Response(body, { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
  }
  const body = Readable.toWeb(createReadStream(file)) as unknown as ReadableStream;
  return new Response(body, { status: 200, headers: { ...headers, "Content-Length": String(size) } });
}

export const mimeFor = (key: string) =>
  key.endsWith(".jpg") ? "image/jpeg" : key.endsWith(".webm") ? "video/webm" : key.endsWith(".mov") ? "video/quicktime" : key.endsWith(".mkv") ? "video/x-matroska" : "video/mp4";
