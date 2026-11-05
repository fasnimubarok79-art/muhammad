import { describe, expect, it } from "vitest";
import { aspectLabel, buildAudit, type AuditInput } from "@/lib/media/audit";

const words = Array.from({ length: 40 }, (_, i) => ({ w: `w${i}`, s: 1 + i * 0.5, e: 1 + i * 0.5 + 0.4, p: i % 10 === 0 ? 0.3 : 0.9 }));
const base: AuditInput = {
  source: { id: "s1", originalName: "talk.mp4", platform: "upload", sourceUrl: null, sizeBytes: 1000, durationSec: 30, width: 1920, height: 1080, fps: 30, hasAudio: true, analysis: { silences: [{ start: 21, end: 22 }, { start: 25, end: 25.3 }], scenes: [12] }, createdAt: new Date() },
  probe: { durationSec: 30, formatName: "mov,mp4", sizeBytes: 2048, video: { codec: "h264", width: 1920, height: 1080, fps: 29.97, rotation: 0, pixFmt: "yuv420p" }, audio: { codec: "aac", sampleRate: 48000, channels: 2 } },
  transcript: { language: "id", engine: "faster-whisper:small", words },
  clips: [
    { id: "c1", title: "Low", startSec: 0, endSec: 15, score: 40, hookScore: 30, hookText: null, insights: null, segments: 3 },
    { id: "c2", title: "High", startSec: 10, endSec: 25, score: 80, hookScore: 70, hookText: "Why", insights: { why: "Opens with a question" }, segments: 0 },
  ],
};

describe("audit report", () => {
  it("prefers live ffprobe values and labels the aspect", () => {
    const r = buildAudit(base);
    expect(r.file.videoCodec).toBe("h264");
    expect(r.file.audio?.codec).toBe("aac");
    expect(r.file.fps).toBe(29.97);
    expect(r.file.sizeBytes).toBe(2048);
    expect(r.file.aspect?.ratio).toBe("16:9");
    expect(aspectLabel(1080, 1920)?.shape).toBe("portrait");
    expect(aspectLabel(160, 288)).toMatchObject({ ratio: "9:16", exact: "5:9" });
  });

  it("speech, pauses, scenes and cut points come from the stored data", () => {
    const r = buildAudit(base);
    expect(r.speech?.words).toBe(40);
    expect(r.speech?.lowConfidenceWords).toBe(4);
    expect(r.silences.count).toBe(2);
    expect(r.scenes.count).toBe(1);
    // only the 1s pause qualifies as a cut (0.6s rule), plus the scene change
    expect(r.cutPoints.points).toEqual([{ t: 12, kind: "scene", sec: 0 }, { t: 21.5, kind: "pause", sec: 1 }]);
  });

  it("highlights are sorted by score and B-roll windows are long shots with speech", () => {
    const r = buildAudit(base);
    expect(r.highlights.clips.map((c) => c.clipId)).toEqual(["c2", "c1"]);
    expect(r.highlights.clips[0].why).toBe("Opens with a question");
    expect(r.broll.candidates.map((b) => [b.start, b.end])).toEqual([[0, 12], [12, 30]]);
    expect(r.subtitles).toMatchObject({ clipsWithSubtitles: 1, lines: 3 });
  });

  it("says what is missing instead of guessing", () => {
    const r = buildAudit({ ...base, probe: null, probeError: "The stored media file is missing.", transcript: null, source: { ...base.source, width: 160, height: 288 } });
    expect(r.file.videoCodec).toBeNull();
    expect(r.speech).toBeNull();
    expect(r.warnings.join(" ")).toMatch(/missing/);
    expect(r.warnings.join(" ")).toMatch(/No transcript/);
    expect(r.warnings.join(" ")).toMatch(/160×288/);
  });
});
