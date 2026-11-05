"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { fmtTime } from "@/lib/client";
import type { Config, Seg } from "./useEditor";
import { cropFraction, focusAt, type Keyframe } from "@/lib/media/reframe";
import { keywordIndex, PUNCH_COLORS, PUNCH_KEYWORD_SCALE } from "@/lib/media/subtitles";
import { activeCard } from "@/lib/media/cards";
import { CardView } from "./CardView";

export type ClientTrack = { start: number; end: number; keyframes: Keyframe[]; sampled: number; withFace: number; detector: string };

export type PlayerHandle = { seek: (t: number) => void; toggle: () => void; playing: () => boolean };

type Props = {
  sourceId: string;
  clipId: string;
  hasThumb: boolean;
  clipStart: number;
  clipLen: number;
  config: Config;
  segments: Seg[];
  srcSize: { w: number; h: number } | null;
  track?: ClientTrack | null;
  onTime: (t: number) => void;
};

const RATIO: Record<Config["aspect"], number> = { "9:16": 9 / 16, "16:9": 16 / 9, "1:1": 1 };

/** Subtitle for clip-relative time t, with the active word. Driven by the real playback clock. */
export function activeSubtitle(segments: Seg[], t: number) {
  const seg = segments.find((s) => t >= s.start && t < s.end);
  if (!seg) return null;
  const idx = seg.words.findIndex((w, i) => t >= w.s && (i === seg.words.length - 1 || t < seg.words[i + 1].s));
  return { seg, idx };
}

export const Player = forwardRef<PlayerHandle, Props>(function Player({ sourceId, clipId, hasThumb, clipStart, clipLen, config, segments, srcSize, track, onTime }, ref) {
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [t, setT] = useState(config.trimStart);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [subs, setSubs] = useState(true);
  const [safe, setSafe] = useState(false);
  const [thirds, setThirds] = useState(false);

  const inT = config.trimStart;
  const outT = Math.min(config.trimEnd, clipLen);

  const seek = useCallback((local: number) => {
    const v = video.current;
    const c = Math.max(inT, Math.min(outT - 0.01, local));
    if (v) v.currentTime = clipStart + c;
    setT(c);
    onTime(c);
  }, [clipStart, inT, outT, onTime]);

  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused) {
      const local = v.currentTime - clipStart;
      if (local < inT || local >= outT - 0.02) v.currentTime = clipStart + inT;
      void v.play().catch(() => setError("Playback was blocked by the browser. Press play again."));
    } else v.pause();
  }, [clipStart, inT, outT]);

  useImperativeHandle(ref, () => ({ seek, toggle, playing: () => !video.current?.paused }), [seek, toggle]);

  // per-frame clock so karaoke highlighting follows real playback, including seeks
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = video.current;
      if (v) {
        const local = v.currentTime - clipStart;
        if (!v.paused && local >= outT) {
          v.pause();
          v.currentTime = clipStart + outT - 0.01;
        }
        setT(local);
        onTime(local);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [clipStart, outT, onTime]);

  useEffect(() => {
    if (video.current) {
      video.current.volume = volume;
      video.current.muted = muted;
    }
  }, [volume, muted]);

  const card = activeCard(config.cards, t);
  // a card covers the caption in the render too (it sits on a higher ASS layer)
  const sub = subs && !card && config.burnSubtitles ? activeSubtitle(segments, t) : null;
  const ratio = RATIO[config.aspect];
  const playW = Math.round(ratio * 1920);
  const fit = config.framing === "crop" || config.framing === "follow" ? "cover" : "contain";
  // follow framing: same maths as the renderer, so the preview frames the face like the export
  const focus =
    config.framing === "follow" && track && srcSize
      ? cropFraction(focusAt(track.keyframes, t + clipStart - track.start), srcSize.w / srcSize.h, ratio)
      : config.framing === "follow"
        ? 0.5
        : config.cropX;
  const vertical = config.aspect === "9:16";
  // marginV is measured at a 1920px-tall frame; express it as a share of the frame height
  const bottomPct = vertical ? (config.style.marginV / 1920) * 100 : 12;
  const fontPct = (config.style.fontSize / 1080) * (vertical ? 100 : 56.25 * 0.8);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative grid min-h-0 flex-1 place-items-center p-3">
        <div ref={frame} className="sub-preview relative max-h-full overflow-hidden rounded-[6px] bg-black" style={{ aspectRatio: String(ratio), height: ratio < 1 ? "100%" : undefined, width: ratio >= 1 ? "100%" : undefined, maxWidth: "100%" }}>
          {config.framing === "blur" && hasThumb && (
            // approximation of the blurred fill; the render uses the moving frames
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/media/thumb/${clipId}`} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover opacity-80 blur-xl brightness-75" />
          )}
          <video
            ref={video}
            src={`/api/media/source/${sourceId}#t=${(clipStart + inT).toFixed(2)}`}
            className="absolute inset-0 h-full w-full"
            style={{ objectFit: fit, objectPosition: `${focus * 100}% 50%` }}
            preload="auto"
            playsInline
            onLoadedData={() => setLoading(false)}
            onWaiting={() => setLoading(true)}
            onCanPlay={() => setLoading(false)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onError={() => { setError("The video could not be loaded."); setLoading(false); }}
            onClick={toggle}
          />
          {card && <CardView key={card.id} card={card} playW={playW} />}
          {sub && (
            <div className="pointer-events-none absolute inset-x-[7%] flex justify-center" style={{ bottom: `${bottomPct}%` }}>
              {config.style.preset === "punch" ? (() => {
                const k = keywordIndex(sub.seg.words);
                const shown = sub.idx >= k || t >= sub.seg.words[k].s;
                const color = PUNCH_COLORS[segments.indexOf(sub.seg) % PUNCH_COLORS.length];
                return (
                  <p className="sub-line" style={{ fontSize: `${fontPct}cqw`, color: config.style.primary, WebkitTextStrokeWidth: `${config.style.outline / 90}em` }}>
                    {sub.seg.words.filter((_, i) => i !== k).map((w) => w.w).join(" ")}
                    {shown && (
                      <span className="sub-pop block italic" style={{ fontSize: `${PUNCH_KEYWORD_SCALE}em`, color, textShadow: `0 0 0.35em ${color}, 0 0.05em 0.08em rgb(0 0 0 / .6)` }}>
                        {sub.seg.words[k].w.replace(/[.,!?;:…]+$/, "").toUpperCase()}
                      </span>
                    )}
                  </p>
                );
              })() : (
              <p className="sub-line" style={{ fontSize: `${fontPct}cqw`, color: config.style.primary, ["--hl" as string]: config.style.highlight, WebkitTextStrokeWidth: `${config.style.outline / 90}em` }}>
                {sub.seg.words.map((w, i) => (
                  <span key={i}>
                    {i > 0 ? " " : ""}
                    <span className={config.style.preset !== "clean" && i === sub.idx ? `sub-word-active ${config.style.preset === "pop" || config.style.preset === "impact" ? "sub-pop" : ""}` : ""}>{w.w}</span>
                  </span>
                ))}
              </p>
              )}
            </div>
          )}
          {safe && vertical && (
            <div aria-hidden className="pointer-events-none absolute inset-0">
              <div className="absolute inset-x-0 top-0 border-b border-dashed border-warn/70 bg-warn/10" style={{ height: "13%" }} />
              <div className="absolute inset-x-0 bottom-0 border-t border-dashed border-warn/70 bg-warn/10" style={{ height: "21%" }} />
            </div>
          )}
          {thirds && (
            <div aria-hidden className="pointer-events-none absolute inset-0" style={{ backgroundImage: "linear-gradient(90deg, transparent calc(33.33% - .5px), rgba(255,255,255,.35) calc(33.33% - .5px) calc(33.33% + .5px), transparent calc(33.33% + .5px) calc(66.66% - .5px), rgba(255,255,255,.35) calc(66.66% - .5px) calc(66.66% + .5px), transparent calc(66.66% + .5px)), linear-gradient(transparent calc(33.33% - .5px), rgba(255,255,255,.35) calc(33.33% - .5px) calc(33.33% + .5px), transparent calc(33.33% + .5px) calc(66.66% - .5px), rgba(255,255,255,.35) calc(66.66% - .5px) calc(66.66% + .5px), transparent calc(66.66% + .5px))" }} />
          )}
          {loading && !error && <div className="absolute inset-0 grid place-items-center bg-black/40 text-[13px] text-muted" role="status">Loading video...</div>}
          {error && <div className="absolute inset-0 grid place-items-center bg-black/70 p-4 text-center text-[13px] text-danger" role="alert">{error}</div>}
        </div>
      </div>

      <div className="border-t border-line px-3 py-2">
        <input
          type="range"
          aria-label="Seek"
          className="w-full accent-[#FF7A1A]"
          min={inT}
          max={outT}
          step={0.01}
          value={Math.max(inT, Math.min(outT, t))}
          onChange={(e) => seek(Number(e.target.value))}
        />
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <button className="btn-secondary h-8 w-20" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>{playing ? "Pause" : "Play"}</button>
          <span className="text-[13px] tc" aria-live="off">
            {fmtTime(Math.max(0, t - inT))} <span className="text-faint">/ {fmtTime(outT - inT)}</span>
          </span>
          <label className="ml-2 flex items-center gap-1 text-[12px] text-muted">
            <button className="btn-ghost h-8 px-2" onClick={() => setMuted((m) => !m)} aria-pressed={muted}>{muted ? "Unmute" : "Mute"}</button>
            <span className="sr-only">Volume</span>
            <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="w-20 accent-[#3DDC97]" aria-label="Volume" />
          </label>
          <span className="ml-auto flex items-center gap-1">
            <button className="btn-ghost h-8 px-2 text-[12px]" aria-pressed={subs} onClick={() => setSubs((s) => !s)}>Subtitles {subs ? "on" : "off"}</button>
            {vertical && <button className="btn-ghost h-8 px-2 text-[12px]" aria-pressed={safe} onClick={() => setSafe((s) => !s)}>Safe zone</button>}
            <button className="btn-ghost h-8 px-2 text-[12px]" aria-pressed={thirds} onClick={() => setThirds((s) => !s)}>Thirds</button>
            <span className="hidden text-[12px] text-faint lg:inline" title="Preview plays the original source file">Preview: source {srcSize ? `${srcSize.w}×${srcSize.h}` : ""}</span>
            <button className="btn-ghost h-8 px-2 text-[12px]" onClick={() => frame.current?.requestFullscreen?.()}>Fullscreen</button>
          </span>
        </div>
      </div>
    </div>
  );
});
