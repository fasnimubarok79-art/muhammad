import { describe, expect, it } from "vitest";
import {
  buildQualityReport,
  parseBlurMean,
  parseDetectIntervals,
  parseLoudness,
  sumIntervals,
  type AuditInput,
} from "@/lib/media/qc";

const goodProbe = {
  durationSec: 30,
  formatName: "mov,mp4,m4a,3gp,3g2,mj2",
  sizeBytes: 1_000_000,
  video: { codec: "h264", width: 1080, height: 1920, fps: 30, rotation: 0, pixFmt: "yuv420p", durationSec: 30 },
  audio: { codec: "aac", sampleRate: 48000, channels: 2, durationSec: 29.98 },
};

const goodInput: AuditInput = {
  probe: goodProbe,
  expected: { w: 1080, h: 1920, durationSec: 30 },
  decodeOk: true,
  decodeErrors: [],
  blurMean: 5,
  lufs: -14,
  truePeakDb: -1.8,
  blackIntervals: [],
  freezeIntervals: [],
};

describe("quality audit parsing", () => {
  it("reads the ffmpeg blur summary and treats nan as unmeasurable", () => {
    expect(parseBlurMean("[Parsed_blurdetect_0] blur mean: 4.7810101")).toBeCloseTo(4.78, 2);
    expect(parseBlurMean("blur mean: nan")).toBeNull();
    expect(parseBlurMean("nothing here")).toBeNull();
  });

  it("reads integrated loudness and true peak from the ebur128 summary", () => {
    const stderr = [
      "[Parsed_ebur128_0] t: 1.0 TARGET:-23 LUFS M: -18.0 S: -19.0 I: -20.1 LUFS LRA: 2.0 LU FTPK: -4.0 dBFS TPK: -3.0 dBFS",
      "  Summary:",
      "    I:         -14.2 LUFS",
      "  True peak:",
      "    Peak:      -1.4 dBFS",
    ].join("\n");
    expect(parseLoudness(stderr)).toEqual({ lufs: -14.2, truePeakDb: -1.4 });
    expect(parseLoudness("Peak: -inf dBFS")).toEqual({ lufs: null, truePeakDb: null });
  });

  it("parses closed and open black/freeze intervals", () => {
    const stderr = [
      "[Parsed_blackdetect_2] black_start:0 black_end:2.5 black_duration:2.5",
      "[Parsed_freezedetect_3] lavfi.freezedetect.freeze_start: 4",
    ].join("\n");
    expect(parseDetectIntervals(stderr, "black", 10)).toEqual([{ start: 0, end: 2.5 }]);
    expect(parseDetectIntervals(stderr, "freeze", 10)).toEqual([{ start: 4, end: 10 }]);
    expect(sumIntervals([{ start: 0, end: 2.5 }, { start: 4, end: 6 }])).toBe(4.5);
  });
});

describe("quality score", () => {
  it("gives a clean, sharp, correctly loud export 100", () => {
    const report = buildQualityReport(goodInput);
    expect(report.score).toBe(100);
    expect(report.grade).toBe("A");
    expect(report.checks.map((c) => c.id)).toEqual(["technical", "decode", "sharpness", "loudness", "alignment"]);
    expect(report.issues).toEqual([]);
  });

  it("deducts real problems and recommends concrete fixes", () => {
    const report = buildQualityReport({
      ...goodInput,
      probe: { ...goodProbe, video: { ...goodProbe.video, codec: "hevc", width: 1280 }, audio: { ...goodProbe.audio, durationSec: 27 } },
      decodeOk: false,
      decodeErrors: ["Invalid NAL unit size"],
      blurMean: 20,
      lufs: -25,
      truePeakDb: 1.5,
    });
    expect(report.score).toBeLessThan(40);
    expect(report.grade).toBe("D");
    expect(report.issues.some((i) => i.includes("does not match"))).toBe(true);
    expect(report.issues.some((i) => i.includes("decode"))).toBe(true);
    expect(report.issues.some((i) => i.includes("LUFS"))).toBe(true);
    expect(report.recommendations.length).toBeGreaterThan(0);
  });

  it("reports black and frozen sections without automatically deducting them", () => {
    const report = buildQualityReport({ ...goodInput, blackIntervals: [{ start: 0, end: 10 }], freezeIntervals: [{ start: 12, end: 20 }] });
    expect(report.score).toBe(100);
    expect(report.issues.some((i) => i.includes("black frames"))).toBe(true);
    expect(report.issues.some((i) => i.includes("without picture movement"))).toBe(true);
  });

  it("does not pretend a flat picture was sharp or silent audio was loud", () => {
    const report = buildQualityReport({ ...goodInput, blurMean: null, lufs: null, truePeakDb: null });
    expect(report.score).toBe(75);
    expect(report.checks.find((c) => c.id === "sharpness")?.detail).toContain("too little detail");
    expect(report.issues.some((i) => i.includes("too little detail"))).toBe(false);
    expect(report.issues.some((i) => i.includes("loudness"))).toBe(true);
  });
});
