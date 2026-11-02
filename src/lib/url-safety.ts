import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { LookupFunction } from "node:net";

export class UnsafeUrlError extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home.arpa", ".corp"];
const ALLOWED_PORTS = new Set(["", "80", "443"]);

/** Parse and normalise a user-supplied URL. Rejects anything that is not plain public http(s). */
export function normalizeUrl(input: string): URL {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 2048) throw new UnsafeUrlError("URL is empty or too long");
  if (/[\u0000-\u001f\u007f\s]/.test(trimmed)) throw new UnsafeUrlError("URL contains control characters or spaces");
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new UnsafeUrlError("Not a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new UnsafeUrlError("Only http and https links are allowed");
  if (url.username || url.password) throw new UnsafeUrlError("Links with embedded credentials are not allowed");
  if (!ALLOWED_PORTS.has(url.port)) throw new UnsafeUrlError("Non-standard ports are not allowed");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) throw new UnsafeUrlError("Missing host");
  if (host === "localhost" || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new UnsafeUrlError("Local and internal hostnames are blocked");
  }
  const bare = host.replace(/^\[|\]$/g, "");
  if (net.isIP(bare) && isPrivateIp(bare)) throw new UnsafeUrlError("Private, loopback and reserved IP addresses are blocked");
  url.hash = "";
  return url;
}

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

const V4_BLOCKS: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function inV4Block(ip: string): boolean {
  const n = v4ToInt(ip);
  return V4_BLOCKS.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (v4ToInt(base) & mask);
  });
}

function expandV6(ip: string): number[] {
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  // embedded IPv4 tail
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = v4ToInt(v4[1]);
    s = s.replace(v4[1], `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`);
  }
  const [head, tail] = s.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  const fill = s.includes("::") ? 8 - h.length - t.length : 0;
  return [...h, ...Array(fill).fill("0"), ...t].map((x) => parseInt(x || "0", 16));
}

export function isPrivateIp(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return inV4Block(ip);
  if (kind !== 6) return true; // not an IP we understand: treat as unsafe
  const w = expandV6(ip);
  if (w.length !== 8 || w.some((x) => Number.isNaN(x))) return true;
  const allZeroPrefix = (n: number) => w.slice(0, n).every((x) => x === 0);
  const embeddedV4 = () => `${w[6] >> 8}.${w[6] & 255}.${w[7] >> 8}.${w[7] & 255}`;
  if (allZeroPrefix(8)) return true; // ::
  if (allZeroPrefix(7) && w[7] === 1) return true; // ::1
  if (allZeroPrefix(5) && w[5] === 0xffff) return inV4Block(embeddedV4()); // ::ffff:a.b.c.d
  if (allZeroPrefix(6)) return true; // deprecated ::a.b.c.d
  if (w[0] === 0x64 && w[1] === 0xff9b) return inV4Block(embeddedV4()) || true; // NAT64: refuse
  if ((w[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((w[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  if ((w[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site local
  if ((w[0] & 0xff00) === 0xff00) return true; // multicast
  if (w[0] === 0x2001 && w[1] === 0x0db8) return true; // documentation
  if (w[0] === 0x2002) return true; // 6to4 can tunnel to private v4
  if (w[0] === 0x2001 && w[1] === 0) return true; // teredo
  return false;
}

export type ResolvedTarget = { url: URL; address: string; family: 4 | 6 };

/** Resolve DNS once, require every answer to be public, and return the address to pin. */
export async function resolvePublic(url: URL, resolver = dnsLookup): Promise<ResolvedTarget> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new UnsafeUrlError("Private address");
    return { url, address: host, family: net.isIP(host) as 4 | 6 };
  }
  let answers: Array<{ address: string; family: number }>;
  try {
    answers = await resolver(host, { all: true, verbatim: true });
  } catch {
    throw new UnsafeUrlError("Host could not be resolved");
  }
  if (!answers.length) throw new UnsafeUrlError("Host could not be resolved");
  if (answers.some((a) => isPrivateIp(a.address))) throw new UnsafeUrlError("Host resolves to a private or reserved address");
  return { url, address: answers[0].address, family: answers[0].family as 4 | 6 };
}

export type SafeResponse = {
  status: number;
  url: URL;
  headers: http.IncomingHttpHeaders;
  stream: http.IncomingMessage;
};

/**
 * Fetch with SSRF protection: every hop is re-validated, the TCP connection is pinned to the
 * IP that was validated (defeats DNS rebinding), redirects are manual and limited, and the
 * request has a hard timeout. The caller must consume or destroy `stream`.
 */
export async function safeRequest(
  input: string | URL,
  opts: { method?: "GET" | "HEAD"; timeoutMs?: number; maxRedirects?: number; headers?: Record<string, string> } = {},
): Promise<SafeResponse> {
  const method = opts.method ?? "GET";
  const maxRedirects = opts.maxRedirects ?? 3;
  let current = typeof input === "string" ? normalizeUrl(input) : normalizeUrl(input.toString());
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const target = await resolvePublic(current);
    const res = await requestPinned(target, method, opts.timeoutMs ?? 15_000, opts.headers ?? {});
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      if (hop === maxRedirects) throw new UnsafeUrlError("Too many redirects");
      current = normalizeUrl(new URL(res.headers.location, current).toString());
      continue;
    }
    return { status, url: current, headers: res.headers, stream: res };
  }
  throw new UnsafeUrlError("Too many redirects");
}

function requestPinned(target: ResolvedTarget, method: string, timeoutMs: number, headers: Record<string, string>) {
  const pinned: LookupFunction = (_host, options, cb) => {
    if (typeof options === "object" && options && "all" in options && options.all) {
      (cb as unknown as (e: null, a: Array<{ address: string; family: number }>) => void)(null, [
        { address: target.address, family: target.family },
      ]);
    } else {
      cb(null, target.address, target.family);
    }
  };
  const mod = target.url.protocol === "https:" ? https : http;
  return new Promise<http.IncomingMessage>((resolve, reject) => {
    const req = mod.request(
      target.url,
      {
        method,
        lookup: pinned,
        headers: { "User-Agent": "ClipKitaBot/1.0 (+media-import)", Accept: "*/*", ...headers },
        timeout: timeoutMs,
      },
      resolve,
    );
    req.on("timeout", () => req.destroy(new UnsafeUrlError("Request timed out")));
    req.on("error", reject);
    req.end();
  });
}
