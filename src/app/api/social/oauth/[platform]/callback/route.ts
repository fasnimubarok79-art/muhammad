import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { readSession } from "@/lib/auth";
import { encryptSecret, safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";
import { provider } from "@/lib/social";
import { FEATURES } from "@config/features";

const back = (msg: string, ok = false) => NextResponse.redirect(new URL(`/social?${ok ? "connected" : "error"}=${encodeURIComponent(msg)}`, env().APP_URL));

/**
 * OAuth callback: validates state and the PKCE verifier, exchanges the code with the platform's
 * token endpoint, and stores tokens encrypted (AES-256-GCM). Not yet tested against live
 * platforms because no app credentials are configured.
 */
export async function GET(req: NextRequest, { params }: { params: { platform: string } }) {
  if (!FEATURES.socialAccountLinking) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
  const p = provider(params.platform);
  const s = await readSession();
  if (!p || !s) return back("Session expired, please try again");
  const cookieName = `ck_oauth_${p.id}`;
  const raw = cookies().get(cookieName)?.value;
  cookies().delete(cookieName);
  const state = req.nextUrl.searchParams.get("state") ?? "";
  const code = req.nextUrl.searchParams.get("code");
  if (req.nextUrl.searchParams.get("error")) return back(`${p.label} did not grant access`);
  let saved: { state: string; verifier: string; uid: string };
  try {
    saved = JSON.parse(raw ?? "");
  } catch {
    return back("Login state is missing, please try again");
  }
  if (!code || !safeEqual(state, saved.state) || saved.uid !== s.user.id) return back("Login state did not match, please try again");

  const form = new URLSearchParams({
    [p.clientIdParam]: process.env[p.clientIdEnv] ?? "",
    client_secret: process.env[p.clientSecretEnv] ?? "",
    code,
    grant_type: "authorization_code",
    redirect_uri: `${env().APP_URL}/api/social/oauth/${p.id}/callback`,
    code_verifier: saved.verifier,
  });
  const res = await fetch(p.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form, signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!res || !res.ok) return back(`${p.label} rejected the connection`);
  const tok = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; open_id?: string };
  if (!tok.access_token) return back(`${p.label} returned no access token`);

  const externalId = tok.open_id ?? `${p.id}-${s.user.id}`;
  await db.socialAccount.upsert({
    where: { userId_platform_externalId: { userId: s.user.id, platform: p.id, externalId } },
    create: {
      userId: s.user.id, platform: p.id, externalId, scopes: tok.scope ?? p.scopes.join(" "),
      accessTokenEnc: encryptSecret(tok.access_token, env().SECRET_KEY),
      refreshTokenEnc: tok.refresh_token ? encryptSecret(tok.refresh_token, env().SECRET_KEY) : null,
      expiresAt: tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000) : null,
    },
    update: {
      scopes: tok.scope ?? p.scopes.join(" "),
      accessTokenEnc: encryptSecret(tok.access_token, env().SECRET_KEY),
      refreshTokenEnc: tok.refresh_token ? encryptSecret(tok.refresh_token, env().SECRET_KEY) : undefined,
      expiresAt: tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000) : null,
    },
  });
  await audit("social.connect", { userId: s.user.id, target: p.id });
  return back(`${p.label} connected`, true);
}
