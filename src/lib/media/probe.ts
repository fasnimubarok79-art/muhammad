import { run } from "./exec";

export type ProbeResult = {
  durationSec: number;
  formatName: string;
  sizeBytes: number;
  video?: { codec: string; width: number; height: number; fps: number; rotation: number; pixFmt?: string; durationSec?: number };
  audio?: { codec: string; sampleRate: number; channels: number; durationSec?: number };
};

function parseRate(r?: string): number {
  if (!r) return 0;
  const [n, d] = r.split("/").map(Number);
  return d ? n / d : n || 0;
}

type RawStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  pix_fmt?: string;
  sample_rate?: string;
  channels?: number;
  duration?: string;
  tags?: { rotate?: string };
  side_data_list?: Array<{ rotation?: number }>;
};

export function parseProbe(jsonText: string): ProbeResult {
  const data = JSON.parse(jsonText) as { format?: { duration?: string; format_name?: string; size?: string }; streams?: RawStream[] };
  const streams = data.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video");
  const a = streams.find((s) => s.codec_type === "audio");
  const rotation = Number(v?.tags?.rotate ?? v?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0) || 0;
  return {
    durationSec: Number(data.format?.duration ?? 0),
    formatName: data.format?.format_name ?? "",
    sizeBytes: Number(data.format?.size ?? 0),
    video: v
      ? {
          codec: v.codec_name ?? "",
          width: v.width ?? 0,
          height: v.height ?? 0,
          fps: parseRate(v.avg_frame_rate) || parseRate(v.r_frame_rate),
          rotation,
          pixFmt: v.pix_fmt,
          ...(v.duration !== undefined ? { durationSec: Number(v.duration) } : {}),
        }
      : undefined,
    audio: a
      ? {
          codec: a.codec_name ?? "",
          sampleRate: Number(a.sample_rate ?? 0),
          channels: a.channels ?? 0,
          ...(a.duration !== undefined ? { durationSec: Number(a.duration) } : {}),
        }
      : undefined,
  };
}

export async function probe(ffprobe: string, file: string): Promise<ProbeResult> {
  const out = await run(ffprobe, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { timeoutMs: 60_000 });
  return parseProbe(out);
}

/** Display size after applying rotation metadata (phones record portrait as rotated landscape). */
export function displaySize(v: NonNullable<ProbeResult["video"]>) {
  const r = Math.abs(v.rotation) % 180;
  return r === 90 ? { w: v.height, h: v.width } : { w: v.width, h: v.height };
}
