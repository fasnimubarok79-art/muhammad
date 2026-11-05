// Browser end-to-end test of the Phase 4 editor against a running server + worker on a SEPARATE test
// database. Usage:
//   BASE=http://localhost:3100 TEST_VIDEO=/path/speech.mp4 MEDIA_DIR=/dir/with/red.png,tone.wav,green.mp4,fake.mp4 OUT=/dir node tests/e2e/studio-e2e.mjs
import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const { chromium } = createRequire(import.meta.url)("playwright");
const BASE = process.env.BASE ?? "http://localhost:3100";
const MEDIA = process.env.MEDIA_DIR;
const OUT = process.env.OUT ?? ".";
let pass = 0;
let fail = 0;
const ok = (c, n, x = "") => { if (c) { pass++; console.log("PASS ", n); } else { fail++; console.log("FAIL ", n, x); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class C {
  constructor() { this.cookie = ""; this.csrf = ""; }
  async req(p, { method = "GET", body, raw, headers = {} } = {}) {
    const h = { Origin: BASE, ...headers };
    if (this.cookie) h.Cookie = this.cookie;
    if (method !== "GET" && this.csrf) h["x-csrf-token"] = this.csrf;
    if (body) h["Content-Type"] = "application/json";
    const r = await fetch(BASE + p, { method, headers: h, body: raw ?? (body ? JSON.stringify(body) : undefined) });
    const m = r.headers.get("set-cookie")?.match(/ck_session=([^;]*)/);
    if (m) this.cookie = `ck_session=${m[1]}`;
    const d = (r.headers.get("content-type") ?? "").includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer());
    if (d?.csrfToken) this.csrf = d.csrfToken;
    return { status: r.status, data: d, headers: r.headers };
  }
}

const stamp = Date.now();
const A = new C();
const B = new C();
const regA = await A.req("/api/auth/register", { method: "POST", body: { email: `studio-a-${stamp}@example.com`, password: "correct horse battery", name: "Studio A" } });
const regB = await B.req("/api/auth/register", { method: "POST", body: { email: `studio-b-${stamp}@example.com`, password: "correct horse battery", name: "Studio B" } });
ok(regA.status === 201 && regB.status === 201, "two test users registered (auth is limited to 10 per 15 min per IP)", `${regA.status} ${regB.status}`);
await A.req("/api/auth/me");
await B.req("/api/auth/me");

// a real project: upload, Whisper analysis, clip candidates
const proj = (await A.req("/api/projects", { method: "POST", body: { title: "Phase 4 editor test" } })).data.project;
let r = await A.req(`/api/video/upload?projectId=${proj.id}`, { method: "PUT", raw: readFileSync(process.env.TEST_VIDEO), headers: { "Content-Type": "video/mp4", "X-File-Name": "speech.mp4" } });
ok(r.status === 201, "source upload", r.status);
for (let i = 0; i < 300; i++) {
  const j = (await A.req(`/api/jobs?projectId=${proj.id}`)).data.jobs[0];
  if (["completed", "failed"].includes(j.status)) { ok(j.status === "completed", "analysis job completed", j.error); break; }
  await sleep(1000);
}
const clips = (await A.req(`/api/clips?projectId=${proj.id}`)).data.clips;
const clip = clips.sort((a, b) => b.duration - a.duration)[0];
ok(Boolean(clip), "clip candidate exists");

// ---------- media library API: upload, metadata, thumbnail, validation, ownership ----------
const up = async (c, name, type) => c.req(`/api/projects/${proj.id}/media`, { method: "PUT", raw: readFileSync(`${MEDIA}/${name}`), headers: { "Content-Type": type, "X-File-Name": name } });
const img = await up(A, "red.png", "image/png");
const aud = await up(A, "tone.wav", "audio/wav");
const vid = await up(A, "green.mp4", "video/mp4");
ok(img.status === 201 && img.data.asset.width === 320 && img.data.asset.thumbUrl, "image upload: size and thumbnail", JSON.stringify(img.data));
ok(aud.status === 201 && Math.abs(aud.data.asset.durationSec - 5) < 0.1 && aud.data.asset.hasAudio, "audio upload: duration from ffprobe");
ok(vid.status === 201 && vid.data.asset.width === 640 && vid.data.asset.hasAudio && vid.data.asset.thumbUrl, "video upload: size, audio, thumbnail");
ok((await up(A, "fake.mp4", "video/mp4")).status === 422, "fake video refused by ffprobe check");
ok((await A.req(`/api/projects/${proj.id}/media`, { method: "PUT", raw: "x", headers: { "Content-Type": "application/x-msdownload", "X-File-Name": "a.exe" } })).status === 415, "unsupported type refused");
const bUp = await up(B, "red.png", "image/png");
ok(bUp.status === 404, "upload into someone else's project refused", bUp.status);
r = await A.req(`/api/projects/${proj.id}/media?kind=AUDIO`);
ok(r.data.assets.length === 1 && r.data.assets[0].kind === "AUDIO", "library filter by kind");
r = await A.req(`/api/projects/${proj.id}/media?q=gre`);
ok(r.data.assets.length === 1 && r.data.assets[0].name === "green.mp4", "library search");
for (const [name, path, method] of [["stream the asset", `/api/media/asset/${img.data.asset.id}`, "GET"], ["see the asset thumbnail", `/api/media/asset-thumb/${img.data.asset.id}`, "GET"], ["rename the asset", `/api/media-assets/${img.data.asset.id}`, "PATCH"], ["delete the asset", `/api/media-assets/${img.data.asset.id}`, "DELETE"], ["read the timeline", `/api/clips/${clip.id}/timeline`, "GET"], ["list the project media", `/api/projects/${proj.id}/media`, "GET"]]) {
  const res = await B.req(path, { method, body: method === "PATCH" ? { name: "x" } : undefined });
  ok(res.status === 404, `other user cannot ${name}`, res.status);
}
const bPut = await B.req(`/api/clips/${clip.id}/timeline`, { method: "PUT", body: { version: 1, timeline: { id: "x" } } });
ok(bPut.status === 404, "other user cannot save the timeline", bPut.status);
const thumb = await A.req(img.data.asset.thumbUrl);
ok(thumb.status === 200 && thumb.headers.get("content-type") === "image/jpeg", "thumbnail served");

// ---------- browser ----------
const br = await chromium.launch();
const ctx = await br.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.addCookies([{ name: "ck_session", value: A.cookie.split("=")[1], url: BASE }]);
const pg = await ctx.newPage();
const errs = [];
pg.on("pageerror", (e) => errs.push(String(e)));
pg.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*(409|404)/.test(m.text())) errs.push(m.text()); });
const tlApi = async () => (await A.req(`/api/clips/${clip.id}/timeline`)).data;
const saved = async () => { await pg.getByText("All changes saved").waitFor({ timeout: 20000 }); };
const blocks = (name) => pg.locator(`[aria-label^="${name},"]`);

await pg.goto(`${BASE}/studio/${clip.id}`);
await pg.getByRole("tab", { name: "Media" }).waitFor({ timeout: 30000 });
let t = await tlApi();
ok(t.timeline.tracks.length === 8 && t.version === 1, "existing clip opens with a timeline (8 tracks, version 1)");
const mainItems = (tt) => tt.timeline.items.filter((i) => i.trackId === tt.timeline.tracks.find((x) => x.type === "VIDEO").id).sort((a, b) => a.startFrame - b.startFrame);
ok(mainItems(t).length >= 1, "clip window is on the main track");

// upload through the panel (file input), shows in the library
await pg.locator('input[aria-label="Upload media files"]').setInputFiles(`${MEDIA}/red.png`);
await pg.getByText("red.png added").waitFor({ timeout: 20000 });
ok(await pg.locator("li", { hasText: "red.png" }).count() >= 2, "upload from the media panel");

// add an overlay and an audio item at the playhead, B-roll by drag and drop
await pg.getByRole("button", { name: "Add red.png as an overlay" }).first().click();
await pg.getByRole("button", { name: "Add the sound of tone.wav to the audio track" }).click();
await saved();
// drag the green video from the library onto the B-roll track, about 4 s in
const brollId = t.timeline.tracks.find((x) => x.type === "BROLL").id;
await pg.locator("li", { hasText: "green.mp4" }).first().dragTo(pg.locator(`[data-track="${brollId}"]`), { targetPosition: { x: 4 * 48 + 2, y: 12 } });
await saved();
t = await tlApi();
const overlay = t.timeline.items.find((i) => i.kind === "image");
const audio = t.timeline.items.find((i) => i.kind === "audio");
const brollItem = t.timeline.items.find((i) => i.trackId === brollId);
ok(overlay && audio, "overlay and audio items added from the library buttons and saved", JSON.stringify(t.timeline.items.map((i) => i.kind)));
ok(brollItem && brollItem.kind === "video" && Math.abs(brollItem.startFrame / t.timeline.fps - 4) < 0.5 && brollItem.transform.fit === "cover", "drag and drop from the library onto the B-roll track", JSON.stringify(brollItem));

// split the main clip at 2 s, duplicate, ripple delete
await pg.keyboard.press("Escape");
await pg.getByRole("slider", { name: "Seek" }).fill("2");
await pg.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => undefined);
await pg.keyboard.press("Escape");
await pg.keyboard.press("s");
await saved();
t = await tlApi();
const afterSplit = mainItems(t);
ok(afterSplit.length === 2 && afterSplit[1].sourceInFrame === afterSplit[0].sourceInFrame + afterSplit[0].durationFrames, "S splits the main clip, source range continuous", JSON.stringify(afterSplit.map((i) => [i.startFrame, i.durationFrames, i.sourceInFrame])));
await pg.keyboard.press("Control+d");
await saved();
t = await tlApi();
const dup = mainItems(t);
ok(dup.length === 3, "Ctrl+D duplicates the selected clip", dup.length);
await pg.keyboard.press("Shift+Delete");
await saved();
t = await tlApi();
ok(mainItems(t).length === 2, "Shift+Delete ripple-deletes the duplicate");

// undo / redo
await pg.keyboard.press("Control+z");
await saved();
ok(mainItems(await tlApi()).length === 3, "undo brings the duplicate back");
await pg.keyboard.press("Control+Shift+z");
await saved();
ok(mainItems(await tlApi()).length === 2, "redo removes it again");

// move the overlay by dragging, trim its right edge
const ovBlock = blocks("red.png").first();
const bb = await ovBlock.boundingBox();
await pg.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
await pg.mouse.down();
await pg.mouse.move(bb.x + bb.width / 2 + 96, bb.y + bb.height / 2, { steps: 8 });
await pg.mouse.up();
await saved();
t = await tlApi();
const moved = t.timeline.items.find((i) => i.id === overlay.id);
ok(moved.startFrame > overlay.startFrame && moved.durationFrames === overlay.durationFrames, "drag moves the overlay, length kept", `${overlay.startFrame} -> ${moved.startFrame}`);
const bb2 = await ovBlock.boundingBox();
await pg.mouse.move(bb2.x + bb2.width - 2, bb2.y + bb2.height / 2);
await pg.mouse.down();
await pg.mouse.move(bb2.x + bb2.width + 48, bb2.y + bb2.height / 2, { steps: 6 });
await pg.mouse.up();
await saved();
t = await tlApi();
const trimmed = t.timeline.items.find((i) => i.id === overlay.id);
ok(trimmed.durationFrames > moved.durationFrames && trimmed.startFrame === moved.startFrame, "drag the edge trims the overlay", `${moved.durationFrames} -> ${trimmed.durationFrames}`);

// keyframes from the inspector: x at the item start and end
await ovBlock.click();
await pg.getByRole("slider", { name: "Seek" }).fill(String(trimmed.startFrame / t.timeline.fps));
await pg.getByRole("button", { name: /Add Position X keyframe/ }).click();
await pg.getByRole("slider", { name: "Seek" }).fill(String((trimmed.startFrame + trimmed.durationFrames - 1) / t.timeline.fps));
await pg.locator("#ii-x").fill("0.8");
await pg.getByRole("button", { name: /Add Position X keyframe|Remove Position X keyframe/ }).first().waitFor();
await saved();
t = await tlApi();
const kf = t.timeline.items.find((i) => i.id === overlay.id).keyframes.filter((k) => k.prop === "x");
ok(kf.length === 2 && kf.some((k) => Math.abs(k.value - 0.8) < 0.01), "two position keyframes from the inspector", JSON.stringify(kf));

// text and effect from the panels
await pg.getByRole("tab", { name: "Text" }).click();
await pg.getByRole("button", { name: /YOUR TITLE/ }).click();
await pg.getByRole("tab", { name: "Effects" }).click();
await pg.getByRole("button", { name: /Black and white/ }).click();
await saved();
t = await tlApi();
ok(t.timeline.items.some((i) => i.kind === "text") && t.timeline.items.some((i) => i.kind === "effect" && i.effects.type === "bw"), "text and effect items added");

// track lock refuses edits; mute and marker are saved
const ovTrack = t.timeline.tracks.find((x) => x.id === overlay.trackId);
await pg.getByRole("button", { name: `Lock ${ovTrack.name}` }).click();
await ovBlock.click();
await pg.keyboard.press("Delete");
await pg.getByText("Items on locked tracks cannot be deleted").waitFor({ timeout: 5000 });
ok(true, "locked track refuses delete");
await pg.getByRole("button", { name: `Unlock ${ovTrack.name}` }).click();
const auTrack = t.timeline.tracks.find((x) => x.type === "AUDIO");
await pg.getByRole("button", { name: `Mute ${auTrack.name}` }).click();
await pg.keyboard.press("Escape");
await pg.keyboard.press("m");
await saved();
t = await tlApi();
ok(t.timeline.tracks.find((x) => x.id === auTrack.id).muted && t.timeline.markers.length === 1, "mute and marker saved");
await pg.getByRole("button", { name: `Unmute ${auTrack.name}` }).click();
await saved();

// word card still works and is drawn on the Cards lane
await pg.getByRole("tab", { name: "Cards" }).click();
await pg.getByRole("slider", { name: "Seek" }).fill("6");
await pg.getByRole("button", { name: "Add card at playhead" }).click();
await saved();
ok(await pg.locator('[title^="Card: "]').count() === 1, "word card on the Cards lane");

// reopen: everything comes back from the server
const before = await tlApi();
await pg.reload();
await pg.getByRole("tab", { name: "Media" }).waitFor({ timeout: 30000 });
await pg.waitForTimeout(800);
const after = await tlApi();
ok(JSON.stringify(after.timeline) === JSON.stringify(before.timeline) && (await blocks("red.png").count()) === 1, "reload: the saved timeline is reopened unchanged");
await pg.screenshot({ path: `${OUT}/studio-desktop.png` });

// version conflict: another tab saves first
const other = await A.req(`/api/clips/${clip.id}/timeline`, { method: "PUT", body: { version: after.version, timeline: { ...after.timeline, markers: [...after.timeline.markers, { id: "othertab", frame: 3, label: "other tab", color: "#FF7A1A" }] } } });
ok(other.status === 200, "a second writer saves");
await pg.keyboard.press("m");
await pg.getByText("This timeline was saved from another tab").waitFor({ timeout: 20000 });
ok(true, "the editor shows the version conflict instead of overwriting");
await pg.getByRole("button", { name: "Keep my version" }).click();
await saved();
const kept = await tlApi();
ok(kept.version === after.version + 2 && kept.timeline.markers.length === 2 && !kept.timeline.markers.some((m) => m.id === "othertab"), "keep my version saves on top of the newer one");

// delete safety
r = await A.req(`/api/media-assets/${kept.timeline.items.find((i) => i.id === overlay.id).mediaAssetId}`, { method: "DELETE" });
ok(r.status === 409 && r.data.error.code === "IN_USE" && r.data.error.clips.length === 1, "asset in use cannot be deleted (names the clip)", r.status);
const unused = await up(A, "tone.wav", "audio/wav");
ok((await A.req(`/api/media-assets/${unused.data.asset.id}`, { method: "DELETE" })).status === 200, "unused asset can be deleted");

// render through the worker and download
await pg.getByRole("button", { name: "Export", exact: true }).click();
await pg.getByRole("radio", { name: /450p/ }).click();
await pg.getByRole("button", { name: /^Render 450p/ }).click();
let job = null;
for (let i = 0; i < 300; i++) {
  const js = (await A.req(`/api/jobs?projectId=${proj.id}`)).data.jobs.filter((j) => j.kind === "RENDER");
  if (js[0] && ["completed", "failed"].includes(js[0].status)) { job = js[0]; break; }
  await sleep(1000);
}
ok(job?.status === "completed", "render job completed in the worker", job?.error);
await A.req(`/api/renders/${job.id}/download`, { method: "POST" }); // pay the download (10 tokens)
const dl = await A.req(`/api/renders/${job.id}/download`);
ok(dl.status === 200 && dl.data.length > 10000, "download the MP4", dl.status);
writeFileSync(`${OUT}/phase4-render.mp4`, dl.data);
const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", `${OUT}/phase4-render.mp4`], { encoding: "utf8" }));
const v = probe.streams.find((s) => s.codec_type === "video");
const a = probe.streams.find((s) => s.codec_type === "audio");
const tlDur = Math.max(...kept.timeline.items.map((i) => i.startFrame + i.durationFrames)) / kept.timeline.fps;
ok(v.codec_name === "h264" && a.codec_name === "aac" && v.width === 450 && v.height === 800, "ffprobe: H.264 + AAC 450x800", `${v.codec_name} ${a?.codec_name} ${v.width}x${v.height}`);
ok(Math.abs(Number(probe.format.duration) - tlDur) < 0.15, "rendered length = timeline length", `${probe.format.duration} vs ${tlDur}`);
// the overlay keyframes are in the pixels: red moves right between its first and last frame
const ov = kept.timeline.items.find((i) => i.id === overlay.id);
const redX = (sec) => {
  const raw = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(sec), "-i", `${OUT}/phase4-render.mp4`, "-frames:v", "1", "-vf", "scale=90:160", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  let s = 0, n = 0;
  for (let i = 0; i < raw.length; i += 3) if (raw[i] > 170 && raw[i + 1] < 90 && raw[i + 2] < 90) { s += ((i / 3) % 90) / 89; n++; }
  return n > 5 ? s / n : NaN;
};
const fps = kept.timeline.fps;
const x0 = redX((ov.startFrame + 2) / fps);
const x1 = redX((ov.startFrame + ov.durationFrames - 3) / fps);
ok(x0 < 0.6 && x1 > 0.7, "overlay keyframes render: red moves from centre to x≈0.8", `${x0} -> ${x1}`);
const tone = (from, to) => {
  const out = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", "-ss", String(from), "-t", String(to - from), "-i", `${OUT}/phase4-render.mp4`, "-vn", "-af", "bandpass=f=1000:width_type=h:w=40,astats=metadata=1:reset=0,ametadata=print:key=lavfi.astats.Overall.RMS_level", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const all = [...out.matchAll(/RMS_level=(-?[\d.]+|-inf)/g)].map((m) => (m[1] === "-inf" ? -120 : Number(m[1])));
  return all.at(-1) ?? -120;
};
const au = kept.timeline.items.find((i) => i.kind === "audio");
const inTone = tone(au.startFrame / fps + 0.2, Math.min((au.startFrame + au.durationFrames) / fps, tlDur) - 0.2);
ok(inTone > -45, "audio track item is in the mix", inTone);

// layouts (export dialog closed)
await pg.getByRole("button", { name: "Close" }).first().click();
for (const [w, h, name] of [[1024, 768, "tablet"], [390, 844, "mobile"]]) {
  await pg.setViewportSize({ width: w, height: h });
  await pg.waitForTimeout(600);
  const overflow = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 0, `${name}: no horizontal page overflow`, overflow);
  await pg.screenshot({ path: `${OUT}/studio-${name}.png` });
}
ok(await pg.getByRole("tab", { name: "Clips" }).isVisible(), "mobile: tap editing tabs instead of the drag timeline");
ok(errs.length === 0, "no console errors", errs.join(" | "));
await br.close();
console.log(JSON.stringify({ project: proj.id, clip: clip.id }));
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
