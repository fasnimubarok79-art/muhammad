"use client";

import type { ReactNode } from "react";
import { fmtTime } from "@/lib/client";
import { forProp, propValue } from "@/lib/timeline/keyframes";
import { end, mainTrack, updateItem } from "@/lib/timeline/ops";
import { EFFECT_TYPES, type Item, type KfProp, type MediaInfo, type TimelineDoc, type Track } from "@/lib/timeline/schema";

type Props = {
  doc: TimelineDoc;
  item: Item;
  track: Track;
  media: MediaInfo | undefined;
  time: number; // timeline seconds
  onDoc: (d: TimelineDoc, group?: boolean) => void;
  onSeek: (t: number) => void;
};

function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={htmlFor} className="w-20 shrink-0 text-[12px] text-muted">{label}</label>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-line px-3 py-3">
      <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-faint">{title}</h3>
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
  );
}

const PROP_LABEL: Record<KfProp, string> = { x: "Position X", y: "Position Y", scale: "Scale", opacity: "Opacity", volume: "Volume" };

/** Settings of the selected timeline item. Values with keyframes are edited at the playhead. */
export function ItemInspector({ doc, item, track, media, time, onDoc, onSeek }: Props) {
  const fps = doc.fps;
  const local = Math.max(0, Math.min(item.durationFrames, Math.round(time * fps) - item.startFrame));
  const inside = Math.round(time * fps) >= item.startFrame && Math.round(time * fps) <= end(item);
  const isMain = track.id === mainTrack(doc).id;
  const visualLayer = (item.kind === "video" || item.kind === "image") && !isMain;
  const locked = track.locked;
  const patch = (p: Partial<Item>, group = true) => {
    const n = updateItem(doc, item.id, p);
    if (n) onDoc(n, group);
  };
  const tf = item.transform;

  const base = (prop: KfProp) => (prop === "opacity" ? item.opacity : prop === "volume" ? item.volume : tf?.[prop] ?? (prop === "scale" ? 1 : 0.5));
  const value = (prop: KfProp) => propValue(item.keyframes, prop, local, base(prop));
  /** With keyframes: set (or add) the keyframe at the playhead. Without: change the base value. */
  const setProp = (prop: KfProp, v: number) => {
    const list = forProp(item.keyframes, prop);
    if (list.length) {
      const others = item.keyframes.filter((k) => !(k.prop === prop && k.frame === local));
      const ease = list.find((k) => k.frame === local)?.ease ?? "linear";
      patch({ keyframes: [...others, { prop, frame: local, value: v, ease }] });
    } else if (prop === "opacity") patch({ opacity: v });
    else if (prop === "volume") patch({ volume: v });
    else if (tf) patch({ transform: { ...tf, [prop]: v } });
  };
  const slider = (prop: KfProp, min: number, max: number, step: number) => {
    const id = `ii-${prop}`;
    const has = forProp(item.keyframes, prop).length > 0;
    const onKf = item.keyframes.some((k) => k.prop === prop && k.frame === local);
    return (
      <Row label={PROP_LABEL[prop]} htmlFor={id}>
        <div className="flex items-center gap-1.5">
          <input id={id} type="range" min={min} max={max} step={step} value={value(prop)} disabled={locked} onChange={(e) => setProp(prop, Number(e.target.value))} className="w-full accent-[#FF7A1A]" />
          <span className="w-10 text-right text-[11px] tc">{value(prop).toFixed(2)}</span>
          <button
            className={`grid h-6 w-6 shrink-0 place-items-center rounded text-[12px] ${onKf ? "text-edit" : has ? "text-ink" : "text-faint"} hover:text-edit disabled:opacity-40`}
            disabled={locked || !inside}
            aria-label={`${onKf ? "Remove" : "Add"} ${PROP_LABEL[prop]} keyframe at the playhead`}
            title={inside ? (onKf ? "Remove keyframe here" : "Add keyframe at the playhead") : "Move the playhead over this item"}
            onClick={() => patch({ keyframes: onKf ? item.keyframes.filter((k) => !(k.prop === prop && k.frame === local)) : [...item.keyframes, { prop, frame: local, value: value(prop), ease: "linear" }] }, false)}
          >
            ◆
          </button>
        </div>
      </Row>
    );
  };

  const kfProps: KfProp[] = visualLayer ? ["x", "y", "scale", "opacity", ...(item.kind === "video" && media?.hasAudio ? (["volume"] as const) : [])] : item.kind === "audio" || (item.kind === "video" && media?.hasAudio) ? ["volume"] : [];

  return (
    <div className="text-[13px]">
      <Group title={item.kind === "effect" ? "Effect" : item.kind === "text" ? "Text" : isMain ? "Main video clip" : `${track.name} item`}>
        <p className="text-[12px] text-muted tc">
          {fmtTime(item.startFrame / fps)} → {fmtTime(end(item) / fps)} · {(item.durationFrames / fps).toFixed(2)}s{media ? ` · ${media.name}` : ""}
          {item.kind === "video" || item.kind === "audio" ? ` · from ${fmtTime(item.sourceInFrame / fps)} in the file` : ""}
        </p>
        {locked && <p className="text-[12px] text-warn">This track is locked. Unlock it in the timeline to edit.</p>}
        {(item.kind === "video" || item.kind === "audio") && (
          <Row label="Speed" htmlFor="ii-speed">
            <select id="ii-speed" className="field h-8" disabled={locked} value={item.speed} onChange={(e) => {
              const speed = Number(e.target.value);
              // keep the same part of the file: the item gets longer or shorter
              const dur = Math.max(1, Math.round((item.durationFrames * item.speed) / speed));
              const max = media?.durationSec ? Math.floor(media.durationSec * fps) : Infinity;
              const fit = Math.min(dur, Math.max(1, Math.floor((max - item.sourceInFrame) / speed)));
              const next = { ...doc, items: doc.items.map((i) => (i.id === item.id ? { ...i, speed, durationFrames: fit } : i)) };
              const blocked = doc.items.some((o) => o.trackId === item.trackId && o.id !== item.id && item.startFrame < end(o) && o.startFrame < item.startFrame + fit);
              if (!blocked) onDoc(next, false);
            }}>
              {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map((s) => <option key={s} value={s}>{s}×</option>)}
            </select>
          </Row>
        )}
      </Group>

      {item.kind === "text" && item.text && (
        <Group title="Text">
          <textarea aria-label="Text" className="field h-16 py-1.5" maxLength={120} value={item.text.text} disabled={locked} onChange={(e) => patch({ text: { ...item.text!, text: e.target.value || " " } })} />
          <Row label="Font" htmlFor="ii-font">
            <select id="ii-font" className="field h-8" value={item.text.font} disabled={locked} onChange={(e) => patch({ text: { ...item.text!, font: e.target.value as "sans" | "serif" } }, false)}>
              <option value="sans">Bold sans (Inter Black)</option>
              <option value="serif">Serif (Instrument Serif)</option>
            </select>
          </Row>
          <Row label="Size" htmlFor="ii-size"><input id="ii-size" type="range" min={30} max={300} value={item.text.size} disabled={locked} onChange={(e) => patch({ text: { ...item.text!, size: Number(e.target.value) } })} className="w-full accent-[#FF7A1A]" /></Row>
          <Row label="Colour" htmlFor="ii-color"><input id="ii-color" type="color" value={item.text.color} disabled={locked} onChange={(e) => patch({ text: { ...item.text!, color: e.target.value.toUpperCase() } })} className="h-8 w-full rounded bg-surface2" /></Row>
          <Row label="Outline" htmlFor="ii-ol"><input id="ii-ol" type="range" min={0} max={12} value={item.text.outline} disabled={locked} onChange={(e) => patch({ text: { ...item.text!, outline: Number(e.target.value) } })} className="w-full accent-[#FF7A1A]" /></Row>
          <Row label="Entrance" htmlFor="ii-anim">
            <select id="ii-anim" className="field h-8" value={item.text.anim} disabled={locked} onChange={(e) => patch({ text: { ...item.text!, anim: e.target.value as "fade" | "pop" | "cut" } }, false)}>
              <option value="fade">Fade</option><option value="pop">Pop</option><option value="cut">Cut</option>
            </select>
          </Row>
          <Row label="Position X" htmlFor="ii-tx"><input id="ii-tx" type="range" min={0} max={1} step={0.01} value={tf?.x ?? 0.5} disabled={locked} onChange={(e) => tf && patch({ transform: { ...tf, x: Number(e.target.value) } })} className="w-full accent-[#FF7A1A]" /></Row>
          <Row label="Position Y" htmlFor="ii-ty"><input id="ii-ty" type="range" min={0} max={1} step={0.01} value={tf?.y ?? 0.3} disabled={locked} onChange={(e) => tf && patch({ transform: { ...tf, y: Number(e.target.value) } })} className="w-full accent-[#FF7A1A]" /></Row>
          <Row label="Opacity" htmlFor="ii-top"><input id="ii-top" type="range" min={0} max={1} step={0.01} value={item.opacity} disabled={locked} onChange={(e) => patch({ opacity: Number(e.target.value) })} className="w-full accent-[#FF7A1A]" /></Row>
        </Group>
      )}

      {item.kind === "effect" && item.effects && (
        <Group title="Effect">
          <Row label="Type" htmlFor="ii-fx">
            <select id="ii-fx" className="field h-8" value={item.effects.type} disabled={locked} onChange={(e) => patch({ effects: { ...item.effects!, type: e.target.value as (typeof EFFECT_TYPES)[number] } }, false)}>
              <option value="zoom">Zoom in (main video)</option><option value="flash">Flash</option><option value="bw">Black and white</option><option value="blur">Blur</option>
            </select>
          </Row>
          <Row label="Intensity" htmlFor="ii-int"><input id="ii-int" type="range" min={0} max={1} step={0.05} value={item.effects.intensity ?? 0.5} disabled={locked} onChange={(e) => patch({ effects: { ...item.effects!, intensity: Number(e.target.value) } })} className="w-full accent-[#FF7A1A]" /></Row>
          <p className="text-[11px] text-faint">Duration is the length of the block on the Effects track. Drag its edges to change it.</p>
        </Group>
      )}

      {visualLayer && tf && (
        <Group title="Transform">
          {slider("x", -0.5, 1.5, 0.005)}
          {slider("y", -0.5, 1.5, 0.005)}
          {slider("scale", 0.05, 3, 0.01)}
          {slider("opacity", 0, 1, 0.01)}
          <Row label="Rotation" htmlFor="ii-rot"><input id="ii-rot" type="range" min={-180} max={180} step={1} value={tf.rotation} disabled={locked} onChange={(e) => patch({ transform: { ...tf, rotation: Number(e.target.value) } })} className="w-full accent-[#FF7A1A]" /></Row>
          <Row label="Fit" htmlFor="ii-fit">
            <select id="ii-fit" className="field h-8" value={tf.fit} disabled={locked} onChange={(e) => patch({ transform: { ...tf, fit: e.target.value as "contain" | "cover" } }, false)}>
              <option value="contain">Fit inside the frame</option><option value="cover">Fill the frame</option>
            </select>
          </Row>
        </Group>
      )}

      {(item.kind === "video" || item.kind === "image") && tf && (
        <Group title="Crop">
          {(["l", "r", "t", "b"] as const).map((k) => (
            <Row key={k} label={{ l: "Left", r: "Right", t: "Top", b: "Bottom" }[k]} htmlFor={`ii-c${k}`}>
              <input id={`ii-c${k}`} type="range" min={0} max={0.45} step={0.01} value={tf.crop[k]} disabled={locked} onChange={(e) => patch({ transform: { ...tf, crop: { ...tf.crop, [k]: Number(e.target.value) } } })} className="w-full accent-[#FF7A1A]" />
            </Row>
          ))}
          {isMain && <p className="text-[11px] text-faint">Position and scale of the main video come from Format and framing.</p>}
        </Group>
      )}

      {(item.kind === "audio" || (item.kind === "video" && media?.hasAudio)) && (
        <Group title="Audio">
          {slider("volume", 0, 2, 0.01)}
          <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" className="accent-[#3DDC97]" checked={item.volume === 0} disabled={locked} onChange={(e) => patch({ volume: e.target.checked ? 0 : 1 }, false)} /> Mute this item</label>
          <Row label="Fade in" htmlFor="ii-fi"><input id="ii-fi" type="number" min={0} max={10} step={0.1} className="field h-8 tc" disabled={locked} value={((item.effects?.fadeIn ?? 0) / fps).toFixed(1)} onChange={(e) => patch({ effects: { fadeIn: Math.round(Math.max(0, Number(e.target.value)) * fps), fadeOut: item.effects?.fadeOut ?? 0 } })} /></Row>
          <Row label="Fade out" htmlFor="ii-fo"><input id="ii-fo" type="number" min={0} max={10} step={0.1} className="field h-8 tc" disabled={locked} value={((item.effects?.fadeOut ?? 0) / fps).toFixed(1)} onChange={(e) => patch({ effects: { fadeIn: item.effects?.fadeIn ?? 0, fadeOut: Math.round(Math.max(0, Number(e.target.value)) * fps) } })} /></Row>
        </Group>
      )}

      {visualLayer && !(item.kind === "video" && media?.hasAudio) && (
        <Group title="Fade">
          <Row label="Fade in" htmlFor="ii-vfi"><input id="ii-vfi" type="number" min={0} max={10} step={0.1} className="field h-8 tc" disabled={locked} value={((item.effects?.fadeIn ?? 0) / fps).toFixed(1)} onChange={(e) => patch({ effects: { fadeIn: Math.round(Math.max(0, Number(e.target.value)) * fps), fadeOut: item.effects?.fadeOut ?? 0 } })} /></Row>
          <Row label="Fade out" htmlFor="ii-vfo"><input id="ii-vfo" type="number" min={0} max={10} step={0.1} className="field h-8 tc" disabled={locked} value={((item.effects?.fadeOut ?? 0) / fps).toFixed(1)} onChange={(e) => patch({ effects: { fadeIn: item.effects?.fadeIn ?? 0, fadeOut: Math.round(Math.max(0, Number(e.target.value)) * fps) } })} /></Row>
        </Group>
      )}

      {kfProps.length > 0 && (
        <Group title="Keyframes">
          {kfProps.every((p) => !forProp(item.keyframes, p).length) && <p className="text-[12px] text-muted">Put the playhead on this item and press ◆ next to a value to animate it. Two keyframes make a move.</p>}
          {kfProps.map((p) => {
            const list = forProp(item.keyframes, p);
            if (!list.length) return null;
            return (
              <div key={p}>
                <p className="mb-1 text-[12px] font-medium">{PROP_LABEL[p]}</p>
                <ul className="flex flex-col gap-1">
                  {list.map((k) => (
                    <li key={`${k.prop}-${k.frame}`} className="flex items-center gap-1 text-[11px]">
                      <button className="rounded px-1 text-muted hover:text-ink tc" onClick={() => onSeek((item.startFrame + k.frame) / fps)} aria-label={`Go to keyframe at ${fmtTime((item.startFrame + k.frame) / fps)}`}>{fmtTime((item.startFrame + k.frame) / fps)}</button>
                      <input aria-label="Keyframe time in seconds from the item start" type="number" step={1 / fps} min={0} max={item.durationFrames / fps} className="field h-6 w-16 px-1 text-[11px] tc" disabled={locked} value={(k.frame / fps).toFixed(2)} onChange={(e) => {
                        const fr = Math.max(0, Math.min(item.durationFrames, Math.round(Number(e.target.value) * fps)));
                        if (list.some((o) => o.frame === fr && o !== k)) return;
                        patch({ keyframes: item.keyframes.map((o) => (o === k ? { ...o, frame: fr } : o)) });
                      }} />
                      <input aria-label="Keyframe value" type="number" step={0.01} className="field h-6 w-16 px-1 text-[11px] tc" disabled={locked} value={k.value} onChange={(e) => patch({ keyframes: item.keyframes.map((o) => (o === k ? { ...o, value: Math.max(-10, Math.min(10, Number(e.target.value))) } : o)) })} />
                      <select aria-label="Interpolation" className="field h-6 w-auto px-1 text-[11px]" disabled={locked} value={k.ease} onChange={(e) => patch({ keyframes: item.keyframes.map((o) => (o === k ? { ...o, ease: e.target.value as "linear" | "ease" } : o)) }, false)}>
                        <option value="linear">Linear</option><option value="ease">Ease</option>
                      </select>
                      <button className="ml-auto px-1 text-faint hover:text-danger" disabled={locked} aria-label="Remove keyframe" onClick={() => patch({ keyframes: item.keyframes.filter((o) => o !== k) }, false)}>×</button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </Group>
      )}
    </div>
  );
}
