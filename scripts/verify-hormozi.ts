import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { toAss, HORMOZI_STYLE, type SubtitleStyle, type Segment, type Word } from "../src/lib/media/subtitles";

const FFMPEG = process.env.FFMPEG_PATH ?? "C:/ffmpeg/bin/ffmpeg.exe";
const OUT = process.env.CKP_HORMOZI_OUT ?? join(process.cwd(), "ckp-hormozi-test");
mkdirSync(OUT, { recursive: true });

// 1. Build a 5s test video (color bars + tone) at 1080x1920
const src = join(OUT, "src.mp4");
execFileSync(FFMPEG, [
  "-y", "-hide_banner", "-loglevel", "error",
  "-f", "lavfi", "-i", "testsrc2=s=1080x1920:r=30:d=5",
  "-f", "lavfi", "-i", "sine=frequency=440:duration=5",
  "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", src,
], { stdio: "inherit" });

// 2. Build hormozi-style subtitle segments (one word per segment)
const words: Word[] = [
  { w: "HEY", s: 0.0, e: 1.0 },
  { w: "GUYS", s: 1.0, e: 2.0 },
  { w: "LISTEN", s: 2.0, e: 3.0 },
  { w: "UP", s: 3.0, e: 4.0 },
  { w: "NOW", s: 4.0, e: 5.0 },
];
const segs: Segment[] = words.map((w) => ({
  start: w.s, end: w.e, text: w.w, words: [w],
}));

const style: SubtitleStyle = {
  ...HORMOZI_STYLE as SubtitleStyle,
  preset: "hormozi",
  fontName: "Inter Black",
  fontSize: 110,
  primary: "#FFFFFF",
  highlight: "#FFD21F",
  outline: 12,
  shadow: 6,
  marginV: 700,
  maxCharsPerLine: 14,
};

// 3. Generate the ASS script
const ass = toAss(segs, style, { w: 1080, h: 1920 });
const assPath = join(OUT, "subs.ass");
writeFileSync(assPath, ass, "utf8");
console.log("ASS script written to", assPath);
console.log(ass);

// 4. Burn subtitles into the MP4 via FFmpeg subtitles filter
// Escape the path the same way the worker does (filterPath in src/lib/media/render.ts)
const filterPath = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/,/g, "\\,").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
const assEscaped = filterPath(assPath);
const out = join(OUT, "hormozi-output.mp4");
execFileSync(FFMPEG, [
  "-y", "-hide_banner", "-loglevel", "error",
  "-i", src,
  "-vf", `ass=filename='${assEscaped}'`,
  "-c:a", "copy",
  out,
], { stdio: "inherit" });

console.log("Rendered MP4:", out);
console.log("Open the MP4 to verify the Hormozi active-word \\t \\fscx \\fscy pop animation.");
