// End-to-end API test against a running server + worker.
// Usage: BASE=http://localhost:3000 TEST_VIDEO=/path/with-speech.mp4 OWNER_EMAIL=... OWNER_INITIAL_PASSWORD=... node tests/e2e/api-e2e.mjs
import { readFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const VIDEO = process.env.TEST_VIDEO;
let pass = 0;
let fail = 0;
const ok = (cond, name, extra = "") => {
  if (cond) { pass++; console.log(`PASS  ${name}`); } else { fail++; console.log(`FAIL  ${name} ${extra}`); }
};

class Client {
  constructor(name) { this.name = name; this.cookie = ""; this.csrf = ""; }
  async req(path, { method = "GET", body, raw, headers = {}, origin = BASE, csrf = true } = {}) {
    const h = { Origin: origin, ...headers };
    if (this.cookie) h.Cookie = this.cookie;
    if (csrf && method !== "GET" && this.csrf) h["x-csrf-token"] = this.csrf;
    if (body !== undefined) h["Content-Type"] = "application/json";
    const res = await fetch(BASE + path, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined), redirect: "manual" });
    const set = res.headers.get("set-cookie");
    if (set) {
      const m = set.match(/ck_session=([^;]*)/);
      if (m) this.cookie = m[1] ? `ck_session=${m[1]}` : "";
    }
    const type = res.headers.get("content-type") ?? "";
    const data = type.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer());
    if (data && data.csrfToken) this.csrf = data.csrfToken;
    return { status: res.status, data, headers: res.headers };
  }
  async me() { const r = await this.req("/api/auth/me"); this.csrf = r.data.csrfToken ?? this.csrf; return r.data.user; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitJob(c, id, maxSec = 600) {
  for (let i = 0; i < maxSec; i++) {
    const r = await c.req(`/api/jobs/${id}`);
    const s = r.data.job?.status;
    if (["completed", "failed", "cancelled"].includes(s)) return r.data.job;
    await sleep(1000);
  }
  return null;
}

const stamp = Date.now();
const A = new Client("A");
const B = new Client("B");

// ---- auth + signup grant
let r = await A.req("/api/auth/register", { method: "POST", body: { email: `a-${stamp}@example.com`, password: "correct horse battery", name: "Tester A" } });
ok(r.status === 201, "register user A");
let me = await A.me();
ok(me?.tokenBalance === 500, "new user starts with 500 tokens", JSON.stringify(me));
r = await A.req("/api/auth/register", { method: "POST", body: { email: `a-${stamp}@example.com`, password: "correct horse battery" } });
ok(r.status === 409, "duplicate registration rejected (no second grant)");
r = await A.req("/api/auth/register", { method: "POST", body: { email: process.env.OWNER_EMAIL ?? "ADMIN16112000@gmail.com", password: "correct horse battery" } });
ok(r.status === 409, "owner email cannot be registered by the public");
r = await A.req("/api/auth/register", { method: "POST", body: { email: `weak-${stamp}@example.com`, password: "short" } });
ok(r.status === 400, "weak password rejected");

// ---- CSRF
r = await A.req("/api/projects", { method: "POST", body: { title: "x" }, csrf: false });
ok(r.status === 403 && r.data.error.code === "BAD_CSRF", "write without CSRF token blocked");
r = await A.req("/api/projects", { method: "POST", body: { title: "x" }, origin: "https://evil.example" });
ok(r.status === 403 && r.data.error.code === "BAD_ORIGIN", "cross-origin write blocked");

// ---- project + upload validation
r = await A.req("/api/projects", { method: "POST", body: { title: "E2E project" } });
ok(r.status === 201, "create project");
const projectId = r.data.project.id;
r = await A.req(`/api/video/upload?projectId=${projectId}`, { method: "PUT", raw: "hello", headers: { "Content-Type": "text/plain" } });
ok(r.status === 415, "non-video content type rejected");
r = await A.req(`/api/video/upload?projectId=${projectId}`, { method: "PUT", raw: Buffer.from("this is not really an mp4 file at all"), headers: { "Content-Type": "video/mp4", "X-File-Name": "fake.mp4" } });
ok(r.status === 422, "fake mp4 rejected after ffprobe check");

// ---- universal link connector + SSRF
const link = async (url) => (await A.req("/api/video", { method: "POST", body: { projectId, url } })).data.access;
ok((await link("http://169.254.169.254/latest/meta-data/"))?.accessState === "UNSUPPORTED", "SSRF: cloud metadata IP blocked");
ok((await link("http://localhost:3000/api/auth/me"))?.accessState === "UNSUPPORTED", "SSRF: localhost blocked");
ok((await link("http://[::ffff:127.0.0.1]/"))?.accessState === "UNSUPPORTED", "SSRF: IPv4-mapped IPv6 loopback blocked");
ok((await link("file:///etc/passwd"))?.accessState === "UNSUPPORTED", "SSRF: file:// blocked");
r = await A.req("/api/video", { method: "POST", body: { projectId, url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } });
ok(r.status === 400 && r.data.error.code === "RIGHTS_REQUIRED" && r.data.error.access.accessState === "PROCESSABLE", "YouTube link needs rights confirmation before import");
r = await A.req("/api/video/inspect", { method: "POST", body: { url: "https://www.instagram.com/reel/Cabc123/" } });
ok(r.data.access.accessState === "PROCESSABLE", "Instagram public link is processable via link import");
r = await A.req("/api/video", { method: "POST", body: { projectId, url: "https://www.tiktok.com/@a/video/7234567890123456789", rightsConfirmed: true } });
ok(r.status === 201 && r.data.job?.status === "queued", "confirmed TikTok link queues a download job");
if (r.data.job) await A.req(`/api/jobs/${r.data.job.id}/cancel`, { method: "POST" });

// ---- real upload -> analysis
if (!VIDEO) throw new Error("TEST_VIDEO is required");
r = await A.req(`/api/video/upload?projectId=${projectId}`, { method: "PUT", raw: readFileSync(VIDEO), headers: { "Content-Type": "video/mp4", "X-File-Name": "speech.mp4" } });
ok(r.status === 201 && r.data.job?.status === "queued", "real video uploaded, analysis queued");
const sourceId = r.data.source.id;
let job = await waitJob(A, r.data.job.id);
ok(job?.status === "completed", "analysis job completed by worker", JSON.stringify(job));
r = await A.req(`/api/sources/${sourceId}/transcript`);
ok(r.status === 200 && r.data.transcript.words.length > 5, "transcript has real word timestamps", r.data.transcript?.text);

r = await A.req(`/api/clips?projectId=${projectId}`);
ok(r.status === 200 && r.data.total > 0, "clip gallery lists candidates");
const clipId = r.data.clips[0].id;
r = await A.req(`/api/clips/${clipId}`);
ok(r.status === 200 && r.data.segments.length > 0, "clip detail has subtitle segments");
r = await A.req(`/api/clips/${clipId}/captions?format=srt`);
ok(r.status === 200 && r.data.toString().includes("-->"), "SRT export");
r = await A.req(`/api/media/thumb/${clipId}`);
ok(r.status === 200 && r.headers.get("content-type") === "image/jpeg", "real thumbnail served");
r = await A.req(`/api/media/source/${sourceId}`, { headers: { Range: "bytes=0-1023" } });
ok(r.status === 206 && r.data.length === 1024, "source streaming supports Range (seeking)");

// ---- render with price confirmation + idempotency
r = await A.req(`/api/clips/${clipId}/render?resolution=720p`);
ok(r.data.quote.charged === 5, "720p quote is 5 tokens");
r = await A.req(`/api/clips/${clipId}/render?resolution=1080p`);
ok(r.data.quote.charged === 405, "1080p quote is 405 tokens");
const params = { resolution: "720p", aspect: "9:16", framing: "crop", cropX: 0.5, preset: "clean_professional", removeSilence: true, burnSubtitles: true };
r = await A.req(`/api/clips/${clipId}/render`, { method: "POST", body: { idempotencyKey: `k-${stamp}-wrong`, confirmTotal: 0, params } });
ok(r.status === 409 && r.data.error.code === "PRICE_CHANGED", "unconfirmed price is refused, not charged");
const key = `k-${stamp}-render`;
const [r1, r2] = await Promise.all([
  A.req(`/api/clips/${clipId}/render`, { method: "POST", body: { idempotencyKey: key, confirmTotal: 5, params } }),
  A.req(`/api/clips/${clipId}/render`, { method: "POST", body: { idempotencyKey: key, confirmTotal: 5, params } }),
]);
ok([r1.status, r2.status].includes(201) && r1.data.job.id === r2.data.job.id, "double-submit with same key creates one job", `${r1.status}/${r2.status}`);
me = await A.me();
ok(me.tokenBalance === 495, "charged exactly once (495)", String(me.tokenBalance));
const renderId = r1.data.job.id;
job = await waitJob(A, renderId);
ok(job?.status === "completed", "render completed", JSON.stringify(job?.error));
ok(job?.outputMeta?.video?.width === 720 && job?.outputMeta?.video?.height === 1280 && job?.outputMeta?.video?.codec === "h264" && job?.outputMeta?.audio?.codec === "aac", "output verified 720x1280 h264/aac", JSON.stringify(job?.outputMeta));

// ---- download charge
r = await A.req(`/api/renders/${renderId}/download`);
ok(r.status === 402, "download refused before paying");
r = await A.req(`/api/media/render/${renderId}`, { headers: { Range: "bytes=0-99" } });
ok(r.status === 206, "render preview is free to watch");
r = await A.req(`/api/renders/${renderId}/download`, { method: "POST" });
ok(r.data.charged === 10 && r.data.balance === 485, "download charged 10", JSON.stringify(r.data));
r = await A.req(`/api/renders/${renderId}/download`, { method: "POST" });
ok(r.data.charged === 0 && r.data.alreadyPaid === true, "second download of same file is free");
r = await A.req(`/api/renders/${renderId}/download`);
ok(r.status === 200 && r.headers.get("content-disposition")?.startsWith("attachment") && r.data.length > 10_000, "MP4 downloaded");

// ---- IDOR / BOLA
await B.req("/api/auth/register", { method: "POST", body: { email: `b-${stamp}@example.com`, password: "another long password" } });
await B.me();
for (const [name, path] of [["project", `/api/projects/${projectId}`], ["clip", `/api/clips/${clipId}`], ["job", `/api/jobs/${renderId}`], ["source media", `/api/media/source/${sourceId}`], ["render media", `/api/media/render/${renderId}`], ["transcript", `/api/sources/${sourceId}/transcript`], ["download", `/api/renders/${renderId}/download`]]) {
  r = await B.req(path);
  ok(r.status === 404, `IDOR: user B cannot read A's ${name}`, String(r.status));
}
r = await B.req(`/api/clips/${clipId}`, { method: "PATCH", body: { title: "hacked" } });
ok(r.status === 404, "IDOR: user B cannot edit A's clip");
r = await B.req(`/api/clips/${clipId}/render`, { method: "POST", body: { idempotencyKey: `b-${stamp}-x`, confirmTotal: 5, params } });
ok(r.status === 404, "IDOR: user B cannot render A's clip");
r = await B.req("/api/admin/users");
ok(r.status === 403, "normal user cannot use admin API");

// ---- owner admin
const OU = new Client("OwnerByUsername");
r = await OU.req("/api/auth/login", { method: "POST", body: { login: (process.env.OWNER_USERNAME ?? "ADMINPRO16112000").toLowerCase(), password: process.env.OWNER_INITIAL_PASSWORD } });
ok(r.status === 200 && r.data.mustChangePassword === true, "owner can log in with the admin username (case-insensitive)");
r = await OU.req("/api/auth/login", { method: "POST", body: { login: "ADMINPRO16112000", password: "wrong-pass-123" } });
ok(r.status === 401, "wrong password for admin username is refused");
const O = new Client("Owner");
r = await O.req("/api/auth/login", { method: "POST", body: { email: process.env.OWNER_EMAIL, password: process.env.OWNER_INITIAL_PASSWORD } });
ok(r.status === 200 && r.data.mustChangePassword === true, "owner logs in with initial password and must change it");
r = await O.req("/api/dashboard");
ok(r.status === 403 && r.data.error.code === "PASSWORD_CHANGE_REQUIRED", "owner blocked until password is changed");
const newOwnerPw = `owner-${stamp}-new-pass`;
r = await O.req("/api/auth/change-password", { method: "POST", body: { currentPassword: process.env.OWNER_INITIAL_PASSWORD, newPassword: newOwnerPw } });
ok(r.status === 200, "owner changed password");
me = await O.me();
ok(me.role === "OWNER_ADMIN" && me.unlimited === true && me.mustChangePassword === false, "owner is OWNER_ADMIN with unlimited tokens");
r = await O.req("/api/admin/users");
ok(r.status === 200 && r.data.users.length >= 2, "owner can list users");
const bId = r.data.users.find((u) => u.email === `b-${stamp}@example.com`).id;
r = await O.req(`/api/admin/users/${bId}`, { method: "POST", body: { action: "disable" } });
ok(r.status === 200, "owner disables user B");
r = await B.req("/api/projects");
ok(r.status === 401, "disabled user is signed out");

// ---- export history, profile, sessions, project delete
r = await A.req("/api/jobs?kind=RENDER");
ok(r.status === 200 && r.data.jobs.length >= 1 && r.data.jobs.every((j) => j.kind === "RENDER") && "clipTitle" in r.data.jobs[0], "export history lists only render jobs with clip titles");
r = await A.req("/api/me", { method: "PATCH", body: { name: "Renamed A" } });
ok(r.status === 200 && r.data.name === "Renamed A", "profile name can be changed");
const A2 = new Client("A-second-device");
await A2.req("/api/auth/login", { method: "POST", body: { login: `a-${stamp}@example.com`, password: "correct horse battery" } });
r = await A.req("/api/auth/sessions", { method: "DELETE" });
ok(r.status === 200 && r.data.signedOut >= 1, "sign out other devices");
r = await A2.req("/api/projects");
ok(r.status === 401, "the other device is signed out");
r = await A.req("/api/projects");
ok(r.status === 200, "current device stays signed in");
r = await A.req(`/api/projects/${projectId}?confirm=wrong-name`, { method: "DELETE" });
ok(r.status === 400 && r.data.error.code === "CONFIRM_REQUIRED", "project delete needs the exact name");
r = await O.req(`/api/projects/${projectId}?confirm=E2E%20project`, { method: "DELETE" });
ok(r.status === 404, "another account cannot delete the project");
r = await A.req(`/api/projects/${projectId}?confirm=E2E%20project`, { method: "DELETE" });
ok(r.status === 200 && r.data.filesRemoved >= 3, "project deleted with its media files", JSON.stringify(r.data));
r = await A.req(`/api/media/render/${renderId}`);
ok(r.status === 404, "deleted render is gone");

// ---- logout + brute force limit
r = await A.req("/api/auth/logout", { method: "POST" });
ok(r.status === 200 && (await A.me()) === null, "logout ends the session");
const C = new Client("C");
const codes = [];
for (let i = 0; i < 12; i++) codes.push((await C.req("/api/auth/login", { method: "POST", body: { email: `nobody-${stamp}@example.com`, password: "wrong password" } })).status);
ok(codes.includes(429), "login brute force is rate limited", codes.join(","));

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
