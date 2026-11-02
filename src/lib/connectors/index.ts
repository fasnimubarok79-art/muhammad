import type { AccessState } from "@prisma/client";
import { normalizeUrl, safeRequest, UnsafeUrlError } from "../url-safety";

export type ConnectorResult = {
  platform: string;
  normalizedUrl: string;
  accessState: AccessState;
  reason: string;
  /** What the user can do next, in plain language. */
  nextAction: "process" | "upload_original" | "connect_account" | "none";
  embedUrl?: string;
  meta?: { title?: string; author?: string; thumbnailUrl?: string; contentType?: string; sizeBytes?: number };
};

export interface Connector {
  id: string;
  label: string;
  matches(url: URL): boolean;
  inspect(url: URL, deps: ConnectorDeps): Promise<ConnectorResult>;
}

export type ConnectorDeps = {
  /** Injected so tests never touch the network. */
  probe: (url: URL) => Promise<{ status: number; contentType: string; length?: number; finalUrl: string }>;
  metaAppToken?: string;
};

const hostIs = (url: URL, ...hosts: string[]) =>
  hosts.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));

function youtubeId(url: URL): string | null {
  if (hostIs(url, "youtu.be")) return url.pathname.slice(1).split("/")[0] || null;
  if (url.pathname === "/watch") return url.searchParams.get("v");
  const m = url.pathname.match(/^\/(shorts|embed|live|v)\/([\w-]{6,})/);
  return m ? m[2] : null;
}

const NO_MEDIA_REASON =
  "This platform shows the video through its official player, but its terms and public APIs do not give third-party apps the media file. Upload the original file you own to process it.";

export const youtube: Connector = {
  id: "youtube",
  label: "YouTube",
  matches: (u) => hostIs(u, "youtube.com", "youtu.be", "youtube-nocookie.com"),
  async inspect(url) {
    const id = youtubeId(url);
    if (!id || !/^[\w-]{6,20}$/.test(id)) {
      return { platform: "youtube", normalizedUrl: url.toString(), accessState: "UNSUPPORTED", reason: "No video ID found in this YouTube link.", nextAction: "upload_original" };
    }
    return {
      platform: "youtube",
      normalizedUrl: `https://www.youtube.com/watch?v=${id}`,
      accessState: "PREVIEW_ONLY",
      reason: NO_MEDIA_REASON,
      nextAction: "upload_original",
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
    };
  },
};

export const tiktok: Connector = {
  id: "tiktok",
  label: "TikTok",
  matches: (u) => hostIs(u, "tiktok.com"),
  async inspect(url) {
    const m = url.pathname.match(/\/video\/(\d{8,25})/);
    return {
      platform: "tiktok",
      normalizedUrl: url.toString(),
      accessState: m ? "PREVIEW_ONLY" : "UNSUPPORTED",
      reason: m ? NO_MEDIA_REASON : "Short or share links must be opened once in a browser so the full /video/<id> link is visible.",
      nextAction: "upload_original",
      embedUrl: m ? `https://www.tiktok.com/embed/v2/${m[1]}` : undefined,
    };
  },
};

function metaConnector(id: "instagram" | "facebook", label: string, hosts: string[]): Connector {
  return {
    id,
    label,
    matches: (u) => hostIs(u, ...hosts),
    async inspect(url, deps) {
      if (!deps.metaAppToken) {
        return {
          platform: id,
          normalizedUrl: url.toString(),
          accessState: "AUTHORIZATION_REQUIRED",
          reason: `${label} previews need a Meta app token (oEmbed Read). The server owner must configure META_APP_TOKEN, and the media file itself is still not provided.`,
          nextAction: "upload_original",
        };
      }
      return { platform: id, normalizedUrl: url.toString(), accessState: "PREVIEW_ONLY", reason: NO_MEDIA_REASON, nextAction: "upload_original" };
    },
  };
}

export const instagram = metaConnector("instagram", "Instagram", ["instagram.com", "instagr.am"]);
export const facebook = metaConnector("facebook", "Facebook", ["facebook.com", "fb.watch", "fb.com"]);

const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska", "video/x-msvideo", "video/mpeg"];

export const direct: Connector = {
  id: "direct",
  label: "Direct video URL",
  matches: () => true,
  async inspect(url, deps) {
    let probe;
    try {
      probe = await deps.probe(url);
    } catch (e) {
      const reason = e instanceof UnsafeUrlError ? e.reason : "The server could not reach this link.";
      return { platform: "direct", normalizedUrl: url.toString(), accessState: "UNSUPPORTED", reason, nextAction: "upload_original" };
    }
    if (probe.status === 401 || probe.status === 403) {
      return { platform: "direct", normalizedUrl: url.toString(), accessState: "AUTHORIZATION_REQUIRED", reason: "The file host requires a login. Private or paywalled files are not imported.", nextAction: "upload_original" };
    }
    const type = probe.contentType.split(";")[0].trim().toLowerCase();
    if (probe.status >= 200 && probe.status < 300 && VIDEO_TYPES.includes(type)) {
      return {
        platform: "direct",
        normalizedUrl: probe.finalUrl,
        accessState: "PROCESSABLE",
        reason: "Public video file. It will be downloaded with size and time limits.",
        nextAction: "process",
        meta: { contentType: type, sizeBytes: probe.length },
      };
    }
    return {
      platform: "direct",
      normalizedUrl: url.toString(),
      accessState: "UNSUPPORTED",
      reason: `This link is not a direct video file (HTTP ${probe.status}, ${type || "unknown type"}). Paste a link that ends in a video file, or upload it.`,
      nextAction: "upload_original",
    };
  },
};

export const CONNECTORS: Connector[] = [youtube, tiktok, instagram, facebook, direct];

export async function defaultProbe(url: URL) {
  const res = await safeRequest(url, { method: "HEAD", timeoutMs: 10_000 });
  res.stream.resume();
  const len = Number(res.headers["content-length"]);
  return {
    status: res.status,
    contentType: String(res.headers["content-type"] ?? ""),
    length: Number.isFinite(len) ? len : undefined,
    finalUrl: res.url.toString(),
  };
}

export async function inspectLink(raw: string, deps: ConnectorDeps): Promise<ConnectorResult> {
  let url: URL;
  try {
    url = normalizeUrl(raw);
  } catch (e) {
    return {
      platform: "unknown",
      normalizedUrl: raw.slice(0, 200),
      accessState: "UNSUPPORTED",
      reason: e instanceof UnsafeUrlError ? e.reason : "Invalid link",
      nextAction: "upload_original",
    };
  }
  const connector = CONNECTORS.find((c) => c.matches(url))!;
  return connector.inspect(url, deps);
}
