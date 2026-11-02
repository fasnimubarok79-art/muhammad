import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth";
import { randomToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { provider } from "@/lib/social";

/** Begin OAuth (authorization code + PKCE + state). GET because it is a top-level navigation. */
export async function GET(_req: Request, { params }: { params: { platform: string } }) {
  const s = await readSession();
  if (!s) return NextResponse.redirect(new URL("/login", env().APP_URL));
  const p = provider(params.platform);
  if (!p) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Unknown platform" } }, { status: 404 });
  const clientId = process.env[p.clientIdEnv];
  if (!clientId || !process.env[p.clientSecretEnv]) {
    return NextResponse.redirect(new URL(`/social?error=${encodeURIComponent(`${p.label} is not configured on this server`)}`, env().APP_URL));
  }
  const state = randomToken(24);
  const verifier = randomToken(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  cookies().set(`ck_oauth_${p.id}`, JSON.stringify({ state, verifier, uid: s.user.id }), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/social/oauth", maxAge: 600,
  });
  const url = new URL(p.authUrl);
  url.searchParams.set(p.clientIdParam, clientId);
  url.searchParams.set("redirect_uri", `${env().APP_URL}/api/social/oauth/${p.id}/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", p.scopes.join(p.scopeSeparator));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (p.id === "youtube") {
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
  }
  return NextResponse.redirect(url);
}
