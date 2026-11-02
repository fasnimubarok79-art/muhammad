import { NextResponse, type NextRequest } from "next/server";
import { z, type ZodTypeAny } from "zod";
import { readSession, type SessionUser } from "./auth";
import { safeEqual } from "./crypto";
import { env } from "./env";
import { hitRateLimit, type RateRule } from "./rate-limit";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const notFound = (what = "Resource") => new ApiError(404, "NOT_FOUND", `${what} not found`);

export function clientIp(req: NextRequest): string {
  // Trust X-Forwarded-For only behind a proxy you control (TRUST_PROXY=1).
  if (process.env.TRUST_PROXY === "1") {
    const xff = req.headers.get("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim();
  }
  return req.ip ?? "local";
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Same-origin check for every state-changing request (CSRF layer 1). */
export function checkOrigin(req: NextRequest) {
  if (!MUTATING.has(req.method)) return;
  const origin = req.headers.get("origin");
  const allowed = new URL(env().APP_URL).origin;
  const self = req.nextUrl.origin;
  if (!origin || (origin !== allowed && origin !== self)) {
    throw new ApiError(403, "BAD_ORIGIN", "Cross-origin request blocked");
  }
}

type Ctx<P> = { req: NextRequest; params: P; ip: string };
type AuthedCtx<P> = Ctx<P> & { user: SessionUser };

type Options = {
  rate?: RateRule;
  rateKey?: string;
  /** Allow users who still must change their password (only the change-password route). */
  allowPasswordChange?: boolean;
  ownerOnly?: boolean;
};

/** Next.js control-flow signals (dynamic usage, redirect, notFound) must propagate, never be turned into a response. */
function isNextSignal(err: unknown) {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && (digest === "DYNAMIC_SERVER_USAGE" || digest.startsWith("NEXT_"));
}

function errorResponse(err: unknown) {
  if (isNextSignal(err)) throw err;
  if (err instanceof ApiError) {
    return NextResponse.json({ error: { code: err.code, message: err.message, ...err.extra } }, { status: err.status });
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json(
      { error: { code: "VALIDATION", message: "Invalid input", issues: err.issues.map((i) => ({ path: i.path, message: i.message })) } },
      { status: 400 },
    );
  }
  console.error("[api] unhandled", err instanceof Error ? err.message : err);
  return NextResponse.json({ error: { code: "INTERNAL", message: "Internal error" } }, { status: 500 });
}

function applyRate(ip: string, who: string, opts: Options, req: NextRequest) {
  if (!opts.rate) return;
  const key = `${opts.rateKey ?? req.nextUrl.pathname}:${who || ip}`;
  const r = hitRateLimit(key, opts.rate);
  if (!r.ok) throw new ApiError(429, "RATE_LIMITED", "Too many requests", { retryAfterSec: r.retryAfterSec });
}

/** Public route: origin check + rate limit + error mapping. */
export function publicRoute<P = Record<string, string>>(
  handler: (ctx: Ctx<P>) => Promise<Response>,
  opts: Options = {},
) {
  return async (req: NextRequest, { params }: { params: P }) => {
    try {
      checkOrigin(req);
      const ip = clientIp(req);
      applyRate(ip, "", opts, req);
      return await handler({ req, params, ip });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** Authenticated route: session + CSRF token (layer 2) on writes + rate limit. */
export function authedRoute<P = Record<string, string>>(
  handler: (ctx: AuthedCtx<P>) => Promise<Response>,
  opts: Options = {},
) {
  return async (req: NextRequest, { params }: { params: P }) => {
    try {
      checkOrigin(req);
      const ip = clientIp(req);
      const session = await readSession();
      if (!session) throw new ApiError(401, "UNAUTHENTICATED", "Login required");
      if (MUTATING.has(req.method)) {
        const sent = req.headers.get("x-csrf-token") ?? "";
        if (!sent || !safeEqual(sent, session.csrfToken)) throw new ApiError(403, "BAD_CSRF", "Invalid CSRF token");
      }
      if (session.user.mustChangePassword && !opts.allowPasswordChange) {
        throw new ApiError(403, "PASSWORD_CHANGE_REQUIRED", "Change your initial password first");
      }
      if (opts.ownerOnly && session.user.role !== "OWNER_ADMIN") throw new ApiError(403, "FORBIDDEN", "Owner admin only");
      applyRate(ip, session.user.id, opts, req);
      return await handler({ req, params, ip, user: session.user });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function parseJson<T extends ZodTypeAny>(req: NextRequest, schema: T): Promise<z.infer<T>> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 1_000_000) throw new ApiError(413, "TOO_LARGE", "Body too large");
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, "BAD_JSON", "Body must be JSON");
  }
  return schema.parse(body);
}

/** JSON response that also serialises BigInt (file sizes) and never caches. */
export const json = (data: unknown, status = 200) =>
  new NextResponse(JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? Number(v) : v)), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
