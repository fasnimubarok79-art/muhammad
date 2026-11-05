"use client";

import { useState } from "react";
import { fmtTime } from "@/lib/client";
import { CARD_LOOKS, newCard, type CardAnim, type CardStyle, type WordCard } from "@/lib/media/cards";
import { keywordIndex } from "@/lib/media/subtitles";
import { useToast } from "../ui/use-toast";
import { activeSubtitle } from "./Player";
import type { Doc } from "./useEditor";

const STYLES: Array<{ v: CardStyle; l: string }> = [{ v: "grid", l: "Grid" }, { v: "paper", l: "Paper" }, { v: "black", l: "Black" }, { v: "accent", l: "Accent" }];
const ANIMS: Array<{ v: CardAnim; l: string }> = [{ v: "fade", l: "Fade" }, { v: "pop", l: "Pop" }, { v: "cut", l: "Cut" }];

function Pick<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ v: T; l: string }>; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-ctl bg-surface2 p-0.5">
      {options.map((o) => (
        <button key={o.v} role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)} className={`h-7 rounded-[5px] text-[12px] font-medium ${value === o.v ? "bg-bg text-ink" : "text-muted hover:text-ink"}`}>{o.l}</button>
      ))}
    </div>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="w-20 shrink-0 text-[12px] text-muted">{label}</label>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Word cards: full-frame text inserts that are burned into the render exactly as previewed. */
export function CardPanel({ doc, time, onCards, onSeek }: { doc: Doc; time: number; onCards: (c: WordCard[], group?: boolean) => void; onSeek: (t: number) => void }) {
  const toast = useToast();
  const cards = [...(doc.config.cards ?? [])].sort((a, b) => a.at - b.at);
  const [open, setOpen] = useState<string | null>(null);
  const len = doc.config.trimEnd;
  const update = (id: string, patch: Partial<WordCard>, group = true) => onCards(cards.map((c) => (c.id === id ? { ...c, ...patch } : c)), group);

  const add = () => {
    const at = Math.max(doc.config.trimStart, time);
    if (cards.some((c) => at >= c.at - 0.05 && at < c.at + c.dur)) return toast({ tone: "error", title: "A card is already showing here. Move the playhead first." });
    if (at > len - 0.4) return toast({ tone: "error", title: "Too close to the end of the clip" });
    // suggest the word being spoken, or the line's keyword
    const sub = activeSubtitle(doc.segments, at);
    const word = sub ? (sub.idx >= 0 ? sub.seg.words[sub.idx] : sub.seg.words[keywordIndex(sub.seg.words)]) : null;
    const next = cards.find((c) => c.at > at);
    const card = newCard(at, word?.w.replace(/[.,!?;:…"]+$/g, "") ?? "word");
    card.dur = Math.max(0.3, Math.min(card.dur, (next?.at ?? len) - at, len - at));
    onCards([...cards, card]);
    setOpen(card.id);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line p-2">
        <button className="btn-secondary h-8 px-2.5 text-[12px]" onClick={add}>Add card at playhead</button>
        <span className="text-[11px] text-faint">{cards.length} {cards.length === 1 ? "card" : "cards"}</span>
      </div>
      <ol className="min-h-0 flex-1 overflow-y-auto">
        {cards.length === 0 && (
          <li className="p-3 text-[13px] text-muted">
            No word cards yet. A card fills the frame for a moment with one word or phrase, while the audio keeps playing. Put the playhead where the word is spoken and add one.
          </li>
        )}
        {cards.map((c, i) => {
          const live = time >= c.at && time < c.at + c.dur;
          const expanded = open === c.id;
          const id = (k: string) => `card-${c.id}-${k}`;
          return (
            <li key={c.id} className={`border-b border-line px-2 py-2 ${expanded ? "bg-surface2/60" : ""}`}>
              <div className="flex items-center gap-1.5 text-[11px] tc">
                <button className={`rounded px-1 ${live ? "bg-edit text-bg" : "text-muted hover:text-ink"}`} onClick={() => onSeek(c.at)} aria-label={`Seek to card ${i + 1}`}>{fmtTime(c.at)}</button>
                <input aria-label={`Card ${i + 1} text`} className="field h-7 min-w-0 flex-1 px-2 text-[13px]" value={c.text} maxLength={60} onChange={(e) => update(c.id, { text: e.target.value })} onBlur={(e) => { if (!e.target.value.trim()) update(c.id, { text: "word" }, false); }} />
                <button className="rounded px-1.5 text-muted hover:text-ink" aria-expanded={expanded} aria-controls={id("opts")} onClick={() => setOpen(expanded ? null : c.id)}>{expanded ? "Close" : "Edit"}</button>
                <button className="rounded px-1.5 text-faint hover:text-danger" aria-label={`Delete card ${i + 1}`} onClick={() => onCards(cards.filter((x) => x.id !== c.id))}>Delete</button>
              </div>
              {expanded && (
                <div id={id("opts")} className="mt-2 flex flex-col gap-2">
                  <Pick label="Card background" value={c.style} options={STYLES} onChange={(v) => update(c.id, { style: v, ...CARD_LOOKS[v] }, false)} />
                  <Field label="Start" id={id("at")}>
                    <input id={id("at")} type="number" step={0.05} min={0} max={len} className="field h-7 px-2 text-[12px] tc" value={c.at.toFixed(2)} onChange={(e) => { const v = Number(e.target.value); if (v >= 0 && v < len - 0.3) update(c.id, { at: v }); }} />
                  </Field>
                  <Field label="Duration" id={id("dur")}>
                    <input id={id("dur")} type="number" step={0.1} min={0.3} max={6} className="field h-7 px-2 text-[12px] tc" value={c.dur.toFixed(1)} onChange={(e) => { const v = Number(e.target.value); if (v >= 0.3 && v <= 6) update(c.id, { dur: v }); }} />
                  </Field>
                  <Field label="Font" id={id("font")}>
                    <Pick label="Card font" value={c.font} options={[{ v: "serif", l: "Serif" }, { v: "sans", l: "Bold sans" }]} onChange={(v) => update(c.id, { font: v }, false)} />
                  </Field>
                  <div className="flex gap-3 pl-[88px] text-[12px]">
                    <label className="flex items-center gap-1.5"><input type="checkbox" className="accent-[#3DDC97]" checked={c.italic} onChange={(e) => update(c.id, { italic: e.target.checked }, false)} /> Italic</label>
                    <label className="flex items-center gap-1.5"><input type="checkbox" className="accent-[#3DDC97]" checked={c.upper} onChange={(e) => update(c.id, { upper: e.target.checked }, false)} /> Uppercase</label>
                  </div>
                  <Field label="Size" id={id("size")}>
                    <input id={id("size")} type="range" min={60} max={320} step={2} value={c.size} onChange={(e) => update(c.id, { size: Number(e.target.value) })} className="w-full accent-[#FF7A1A]" />
                  </Field>
                  <Field label="Height" id={id("y")}>
                    <input id={id("y")} type="range" min={0.15} max={0.85} step={0.01} value={c.y} onChange={(e) => update(c.id, { y: Number(e.target.value) })} className="w-full accent-[#FF7A1A]" />
                  </Field>
                  <Field label="Text" id={id("color")}>
                    <input id={id("color")} type="color" value={c.color} onChange={(e) => update(c.id, { color: e.target.value.toUpperCase() })} className="h-7 w-full rounded bg-surface2" />
                  </Field>
                  <Field label="Background" id={id("bg")}>
                    <input id={id("bg")} type="color" value={c.bg} onChange={(e) => update(c.id, { bg: e.target.value.toUpperCase() })} className="h-7 w-full rounded bg-surface2" />
                  </Field>
                  {(c.style === "grid" || c.style === "accent") && (
                    <Field label={c.style === "grid" ? "Grid lines" : "Side bar"} id={id("accent")}>
                      <input id={id("accent")} type="color" value={c.accent} onChange={(e) => update(c.id, { accent: e.target.value.toUpperCase() })} className="h-7 w-full rounded bg-surface2" />
                    </Field>
                  )}
                  <Field label="Entrance" id={id("anim")}>
                    <Pick label="Card entrance" value={c.anim} options={ANIMS} onChange={(v) => update(c.id, { anim: v }, false)} />
                  </Field>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
