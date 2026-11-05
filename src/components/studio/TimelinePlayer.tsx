"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { fmtTime } from "@/lib/client";
import type { WordCard } from "@/lib/media/cards";
import { cropFraction, focusAt, type Keyframe as FaceKf } from "@/lib/media/reframe";
import { PRESETS } from "@/lib/media/render";
import { keywordIndex, PUNCH_COLORS, PUNCH_KEYWORD_SCALE } from "@/lib/media/subtitles";
import { propValue } from "@/lib/timeline/keyframes";
import { end, itemsOn, mainTrack, timelineEnd } from "@/lib/timeline/ops";
import { activeSubtitle, fadeAt, layerBox } from "@/lib/timeline/preview";
import { mediaRef, type Item, type MediaInfo, type TimelineDoc } from "@/lib/timeline/schema";
import { CardView } from "./CardView";
import type { Config, Seg } from "./useEditor";

export type ClientTrack = { start: number; end: number; keyframes: FaceKf[]; sampled: number; withFace: number; detector: string };
export type PlayerHandle = { seek: (t: number) => void; toggle: () => void; playing: () => boolean; step: (frames: number) => void; fullscreen: () => void };

type Props = {
  doc: TimelineDoc;
  media: Map<string, MediaInfo>;
  config: Config;
  segments: Seg[]; // timeline seconds
  cards: Array<WordCard & { start: number }>; // timeline seconds
  clipSourceId: string;
  clipThumb: string | null;
  track: ClientTrack | null;
  onTime: (t: number) => void;
};

const RATIO: Record<Config["aspect"], number> = { "9:16": 9 / 16, "16:9": 16 / 9, "1:1": 1 };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const at = (items: Item[], f: number) => items.find((i) => f >= i.startFrame && f < end(i)) ?? null;

/** Bring one media element to where the timeline says it should be. Small drift is left alone while playing. */
function drive(el: HTMLMediaElement, active: boolean, target: number, rate: number, vol: number, playing: boolean) {
  if (!active) {
    if (!el.paused) el.pause();
    return;
  }
  if (el.playbackRate !== rate) el.playbackRate = rate;
  el.volume = clamp(vol, 0, 1);
  el.muted = vol <= 0;
  const diff = Math.abs(el.currentTime - target);
  if (playing) {
    if (diff > 0.25) el.currentTime = target;
    if (el.paused) void el.play().catch(() => undefined);
  } else {
    if (!el.paused) el.pause();
    if (diff > 0.02) el.currentTime = target;
  }
}

/**
 * Timeline preview. One clock drives every <video>/<audio> element; pictures, text, effects, subtitles
 * and cards are drawn with the renderer's rules (same layer order, keyframes, fit and fade maths).
 * Colour grade and blur are CSS approximations of the FFmpeg filters; the exported file is the reference.
 */
export const TimelinePlayer = forwardRef<PlayerHandle, Props>(function TimelinePlayer({ doc, media, config, segments, cards, clipSourceId, clipThumb, track, onTime }, ref) {
  const frame = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, HTMLMediaElement>());
  const tRef = useRef(0);
  const playingRef = useRef(false);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [subs, setSubs] = useState(true);
  const [safe, setSafe] = useState(false);
  const [thirds, setThirds] = useState(false);
  const docRef = useRef(doc);
  docRef.current = doc;
  const audioMix = useRef({ volume, muted });
  audioMix.current = { volume, muted };

  const fps = doc.fps;
  const total = timelineEnd(doc) / fps;
  const main = mainTrack(doc);
  const mainItems = useMemo(() => itemsOn(doc, main.id), [doc, main.id]);
  const mainRefs = useMemo(() => [...new Set(mainItems.filter((i) => i.kind === "video").map(mediaRef))], [mainItems]);
  const layerTracks = useMemo(() => doc.tracks.filter((x) => (x.type === "BROLL" || x.type === "OVERLAY" || x.type === "VIDEO") && x.id !== main.id).sort((a, b) => a.order - b.order), [doc.tracks, main.id]);
  const layerItems = useMemo(() => layerTracks.flatMap((tr) => itemsOn(doc, tr.id).map((it) => ({ it, tr }))), [doc, layerTracks]);
  const audioItems = useMemo(() => doc.tracks.filter((x) => x.type === "AUDIO").flatMap((tr) => itemsOn(doc, tr.id).map((it) => ({ it, tr }))), [doc]);

  // imperative media sync, every animation frame
  const sync = useCallback((time: number, isPlaying: boolean) => {
    const d = docRef.current;
    const f = time * d.fps;
    const mix = audioMix.current.muted ? 0 : audioMix.current.volume;
    const m = mainTrack(d);
    const mItems = itemsOn(d, m.id);
    const cur = at(mItems, f);
    const trackVol = (tr: { muted: boolean; volume: number }) => (tr.muted ? 0 : tr.volume);
    for (const [key, el] of els.current) {
      const [kind, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
      if (kind === "main") {
        const active = cur && cur.kind === "video" && mediaRef(cur) === id ? cur : null;
        if (active) {
          const local = f - active.startFrame;
          const vol = propValue(active.keyframes, "volume", local, active.volume) * fadeAt(active, local) * trackVol(m) * mix;
          drive(el, true, active.sourceInFrame / d.fps + (local / d.fps) * active.speed, active.speed, vol, isPlaying);
        } else {
          // pre-seek to the next piece of this file so the switch is instant
          const next = mItems.find((i) => i.startFrame >= f && i.kind === "video" && mediaRef(i) === id);
          if (!el.paused) el.pause();
          if (next && next.startFrame - f < d.fps * 1.5 && Math.abs(el.currentTime - next.sourceInFrame / d.fps) > 0.05) el.currentTime = next.sourceInFrame / d.fps;
        }
        continue;
      }
      const found = kind === "ov" ? layerItemsRef.current.find((x) => x.it.id === id) : audioItemsRef.current.find((x) => x.it.id === id);
      if (!found) continue;
      const { it, tr } = found;
      const active = f >= it.startFrame && f < end(it) && !(kind === "ov" && tr.hidden && it.volume <= 0);
      const local = f - it.startFrame;
      const vol = propValue(it.keyframes, "volume", local, it.volume) * fadeAt(it, local) * trackVol(tr) * mix;
      drive(el, active, it.sourceInFrame / d.fps + (Math.max(0, local) / d.fps) * it.speed, it.speed, vol, isPlaying);
    }
  }, []);
  const layerItemsRef = useRef(layerItems);
  layerItemsRef.current = layerItems;
  const audioItemsRef = useRef(audioItems);
  audioItemsRef.current = audioItems;

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const totalNow = timelineEnd(docRef.current) / docRef.current.fps;
      if (playingRef.current) {
        tRef.current = Math.min(totalNow, tRef.current + dt);
        if (tRef.current >= totalNow) {
          playingRef.current = false;
          setPlaying(false);
        }
      }
      setT(tRef.current);
      onTime(tRef.current);
      sync(tRef.current, playingRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [onTime, sync]);

  const seek = useCallback((time: number) => {
    tRef.current = clamp(time, 0, Math.max(0, timelineEnd(docRef.current) / docRef.current.fps - 1 / docRef.current.fps));
    setT(tRef.current);
    onTime(tRef.current);
  }, [onTime]);
  const toggle = useCallback(() => {
    const totalNow = timelineEnd(docRef.current) / docRef.current.fps;
    if (!playingRef.current && tRef.current >= totalNow - 0.02) tRef.current = 0;
    playingRef.current = !playingRef.current;
    setPlaying(playingRef.current);
  }, []);
  const step = useCallback((frames: number) => {
    playingRef.current = false;
    setPlaying(false);
    const fr = Math.round(tRef.current * docRef.current.fps) + frames;
    seek(fr / docRef.current.fps);
  }, [seek]);
  const fullscreen = useCallback(() => void frame.current?.requestFullscreen?.(), []);
  useImperativeHandle(ref, () => ({ seek, toggle, playing: () => playingRef.current, step, fullscreen }), [seek, toggle, step, fullscreen]);

  // ---------- what is on screen at t ----------
  const f = t * fps;
  const ratio = RATIO[config.aspect];
  const playW = Math.round(ratio * 1920);
  const vertical = config.aspect === "9:16";
  const cur = at(mainItems, f);
  const curMedia = cur ? media.get(mediaRef(cur)) : undefined;
  const fit = config.framing === "crop" || config.framing === "follow" ? "cover" : "contain";
  const focus = (() => {
    if (!cur || !curMedia?.width || !curMedia.height) return config.cropX;
    if (config.framing !== "follow") return config.cropX;
    if (!track || cur.sourceVideoId !== clipSourceId) return 0.5;
    const srcT = cur.sourceInFrame / fps + ((f - cur.startFrame) / fps) * cur.speed;
    return cropFraction(focusAt(track.keyframes, srcT - track.start), curMedia.width / curMedia.height, ratio);
  })();
  const effectsNow = doc.tracks.filter((x) => x.type === "EFFECTS" && !x.hidden).flatMap((tr) => itemsOn(doc, tr.id)).filter((i) => f >= i.startFrame && f < end(i) && i.effects?.type);
  const zoom = effectsNow.filter((e) => e.effects!.type === "zoom").reduce((z, e) => z * (1 + 0.5 * (e.effects!.intensity ?? 0.5) * ((f - e.startFrame) / e.durationFrames)), 1);
  const flash = effectsNow.filter((e) => e.effects!.type === "flash" && f - e.startFrame < 0.12 * fps).reduce((a, e) => a + 0.15 + 0.45 * (e.effects!.intensity ?? 0.5), 0);
  const bw = effectsNow.some((e) => e.effects!.type === "bw");
  const blur = effectsNow.filter((e) => e.effects!.type === "blur").reduce((a, e) => Math.max(a, 2 + 18 * (e.effects!.intensity ?? 0.5)), 0);
  const grade = PRESETS[config.preset].eq;
  const filter = `contrast(${grade.contrast}) saturate(${grade.saturation}) brightness(${1 + grade.brightness})${bw ? " grayscale(1)" : ""}${blur ? ` blur(${(blur / playW) * 100}cqw)` : ""}`;
  const texts = doc.tracks.filter((x) => x.type === "TEXT" && !x.hidden).flatMap((tr) => itemsOn(doc, tr.id)).filter((i) => i.text && f >= i.startFrame && f < end(i));
  const cardTrack = doc.tracks.find((x) => x.type === "CARDS");
  const subTrack = doc.tracks.find((x) => x.type === "SUBTITLE");
  const card = cardTrack?.hidden ? null : cards.find((c) => t >= c.start && t < c.start + c.dur) ?? null;
  const sub = subs && !card && config.burnSubtitles && !subTrack?.hidden ? activeSubtitle(segments, t) : null;
  const bottomPct = vertical ? (config.style.marginV / 1920) * 100 : 12;
  const fontPct = (config.style.fontSize / 1080) * (vertical ? 100 : 56.25 * 0.8);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative grid min-h-0 flex-1 place-items-center p-3">
        <div ref={frame} className="sub-preview relative max-h-full overflow-hidden rounded-[6px] bg-black" style={{ aspectRatio: String(ratio), height: ratio < 1 ? "100%" : undefined, width: ratio >= 1 ? "100%" : undefined, maxWidth: "100%" }} onClick={toggle}>
          <div className="absolute inset-0" style={{ filter }}>
            <div className="absolute inset-0" style={{ transform: zoom !== 1 ? `scale(${zoom})` : undefined }}>
              {config.framing === "blur" && cur && !main.hidden && (cur.sourceVideoId === clipSourceId ? clipThumb : curMedia?.thumbUrl) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={(cur.sourceVideoId === clipSourceId ? clipThumb : curMedia?.thumbUrl) ?? ""} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover opacity-80 blur-xl brightness-75" />
              )}
              {mainRefs.map((r) => {
                const m = media.get(r);
                const show = !main.hidden && cur?.kind === "video" && mediaRef(cur) === r;
                return m ? (
                  <video
                    key={r}
                    ref={(el) => { if (el) els.current.set(`main:${r}`, el); else els.current.delete(`main:${r}`); }}
                    src={m.url}
                    className="absolute inset-0 h-full w-full"
                    style={{ objectFit: fit, objectPosition: `${focus * 100}% 50%`, visibility: show ? "visible" : "hidden" }}
                    preload="auto"
                    playsInline
                  />
                ) : null;
              })}
              {cur?.kind === "image" && !main.hidden && curMedia && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={curMedia.url} alt="" className="absolute inset-0 h-full w-full" style={{ objectFit: fit, objectPosition: `${config.cropX * 100}% 50%` }} />
              )}
            </div>
            {layerItems.map(({ it, tr }) => {
              const m = media.get(mediaRef(it));
              if (!m) return null;
              const active = f >= it.startFrame && f < end(it) && !tr.hidden;
              const box = layerBox(it, m.width ?? 16, m.height ?? 9, doc.width, doc.height, f - it.startFrame);
              const c = box.crop;
              const inner = { position: "absolute" as const, width: `${100 / (1 - c.l - c.r)}%`, height: `${100 / (1 - c.t - c.b)}%`, left: `${(-c.l / (1 - c.l - c.r)) * 100}%`, top: `${(-c.t / (1 - c.t - c.b)) * 100}%`, objectFit: "fill" as const };
              return (
                <div key={it.id} aria-hidden className="pointer-events-none absolute overflow-hidden" style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%`, transform: `translate(-50%, -50%) rotate(${box.rotation}deg)`, opacity: active ? box.opacity * fadeAt(it, f - it.startFrame) : 0 }}>
                  {it.kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.url} alt="" style={inner} />
                  ) : (
                    <video ref={(el) => { if (el) els.current.set(`ov:${it.id}`, el); else els.current.delete(`ov:${it.id}`); }} src={m.url} style={inner} preload="auto" playsInline />
                  )}
                </div>
              );
            })}
            {flash > 0 && <div aria-hidden className="pointer-events-none absolute inset-0 bg-white" style={{ opacity: Math.min(0.6, flash) }} />}
          </div>
          {audioItems.map(({ it }) => {
            const m = media.get(mediaRef(it));
            return m ? <audio key={it.id} ref={(el) => { if (el) els.current.set(`au:${it.id}`, el); else els.current.delete(`au:${it.id}`); }} src={m.url} preload="auto" /> : null;
          })}
          {texts.map((it) => {
            const tx = it.text!;
            const local = f - it.startFrame;
            return (
              <p key={it.id} aria-hidden className={`pointer-events-none absolute m-0 whitespace-pre text-center ${tx.anim === "pop" && local < 6 ? "card-in-pop" : tx.anim === "fade" && local < 5 ? "card-in-fade" : ""}`} style={{ left: `${(it.transform?.x ?? 0.5) * 100}%`, top: `${(it.transform?.y ?? 0.3) * 100}%`, transform: "translate(-50%, -50%)", fontFamily: tx.font === "serif" ? '"Instrument Serif", Georgia, serif' : '"Inter Variable", system-ui, sans-serif', fontWeight: tx.font === "serif" ? 400 : 900, fontSize: `${(tx.size / playW) * 100}cqw`, color: tx.color, WebkitTextStroke: tx.outline ? `${(tx.outline / playW) * 100 * 2}cqw #000` : undefined, paintOrder: "stroke fill", opacity: it.opacity, lineHeight: 1.15 }}>
                {tx.text}
              </p>
            );
          })}
          {sub && (
            <div className="pointer-events-none absolute inset-x-[7%] flex justify-center" style={{ bottom: `${bottomPct}%` }}>
              {config.style.preset === "punch" ? (() => {
                const k = keywordIndex(sub.seg.words);
                const shown = sub.idx >= k || (sub.seg.words[k] && t >= sub.seg.words[k].s);
                const color = PUNCH_COLORS[segments.indexOf(sub.seg) % PUNCH_COLORS.length];
                return (
                  <p className="sub-line" style={{ fontSize: `${fontPct}cqw`, color: config.style.primary, WebkitTextStrokeWidth: `${config.style.outline / 90}em` }}>
                    {sub.seg.words.filter((_, i) => i !== k).map((w) => w.w).join(" ")}
                    {shown && sub.seg.words[k] && (
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
          {card && <CardView key={`${card.id}-${card.start}`} card={card} playW={playW} />}
          {safe && vertical && (
            <div aria-hidden className="pointer-events-none absolute inset-0">
              <div className="absolute inset-x-0 top-0 border-b border-dashed border-warn/70 bg-warn/10" style={{ height: "13%" }} />
              <div className="absolute inset-x-0 bottom-0 border-t border-dashed border-warn/70 bg-warn/10" style={{ height: "21%" }} />
            </div>
          )}
          {thirds && (
            <div aria-hidden className="pointer-events-none absolute inset-0" style={{ backgroundImage: "linear-gradient(90deg, transparent calc(33.33% - .5px), rgba(255,255,255,.35) calc(33.33% - .5px) calc(33.33% + .5px), transparent calc(33.33% + .5px) calc(66.66% - .5px), rgba(255,255,255,.35) calc(66.66% - .5px) calc(66.66% + .5px), transparent calc(66.66% + .5px)), linear-gradient(transparent calc(33.33% - .5px), rgba(255,255,255,.35) calc(33.33% - .5px) calc(33.33% + .5px), transparent calc(33.33% + .5px) calc(66.66% - .5px), rgba(255,255,255,.35) calc(66.66% - .5px) calc(66.66% + .5px), transparent calc(66.66% + .5px))" }} />
          )}
          {total <= 0 && <div className="absolute inset-0 grid place-items-center p-4 text-center text-[13px] text-muted">The timeline is empty. Add media from the library.</div>}
        </div>
      </div>

      <div className="border-t border-line px-3 py-2">
        <input type="range" aria-label="Seek" className="w-full accent-[#FF7A1A]" min={0} max={Math.max(0.01, total)} step={1 / fps} value={clamp(t, 0, total)} onChange={(e) => seek(Number(e.target.value))} />
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <button className="btn-ghost h-8 w-8 px-0" onClick={() => step(-1)} aria-label="Previous frame" title="Previous frame (←)">‹</button>
          <button className="btn-secondary h-8 w-20" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>{playing ? "Pause" : "Play"}</button>
          <button className="btn-ghost h-8 w-8 px-0" onClick={() => step(1)} aria-label="Next frame" title="Next frame (→)">›</button>
          <span className="ml-1 text-[13px] tc" aria-live="off">
            {fmtTime(t)} <span className="text-faint">/ {fmtTime(total)} · f{Math.round(f)}</span>
          </span>
          <label className="ml-2 flex items-center gap-1 text-[12px] text-muted">
            <button className="btn-ghost h-8 px-2" onClick={() => setMuted((m) => !m)} aria-pressed={muted}>{muted ? "Unmute" : "Mute"}</button>
            <span className="sr-only">Volume</span>
            <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="w-16 accent-[#3DDC97]" aria-label="Volume" />
          </label>
          <span className="ml-auto flex flex-wrap items-center gap-1">
            <button className="btn-ghost h-8 px-2 text-[12px]" aria-pressed={subs} onClick={() => setSubs((s) => !s)}>Subtitles {subs ? "on" : "off"}</button>
            {vertical && <button className="btn-ghost h-8 px-2 text-[12px]" aria-pressed={safe} onClick={() => setSafe((s) => !s)}>Safe zone</button>}
            <button className="btn-ghost h-8 px-2 text-[12px]" aria-pressed={thirds} onClick={() => setThirds((s) => !s)}>Thirds</button>
            <button className="btn-ghost h-8 px-2 text-[12px]" onClick={fullscreen}>Fullscreen</button>
          </span>
        </div>
      </div>
    </div>
  );
});
