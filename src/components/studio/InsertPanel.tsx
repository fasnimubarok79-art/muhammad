"use client";

import type { EffectType, TextConfig } from "@/lib/timeline/schema";

const TEXTS: Array<{ name: string; text: TextConfig; y: number }> = [
  { name: "Bold title", y: 0.22, text: { text: "YOUR TITLE", font: "sans", size: 120, color: "#FFFFFF", outline: 6, anim: "pop" } },
  { name: "Serif quote", y: 0.4, text: { text: "a quiet line", font: "serif", size: 130, color: "#FFFFFF", outline: 0, anim: "fade" } },
  { name: "Orange label", y: 0.78, text: { text: "PART 1", font: "sans", size: 80, color: "#FF7A1A", outline: 4, anim: "cut" } },
];
const EFFECTS: Array<{ type: EffectType; name: string; note: string; sec: number }> = [
  { type: "zoom", name: "Zoom in", note: "Pushes into the main video over the block", sec: 1.5 },
  { type: "flash", name: "Flash", note: "A short white flash at the start of the block", sec: 0.3 },
  { type: "bw", name: "Black and white", note: "Removes colour from everything below the text", sec: 1.5 },
  { type: "blur", name: "Blur", note: "Blurs the picture, text stays sharp", sec: 1 },
];

/** Adds text and effect items at the playhead. They render through the same pipeline as the preview. */
export function InsertPanel({ kind, onText, onEffect }: { kind: "text" | "effects"; onText: (t: TextConfig, y: number) => void; onEffect: (type: EffectType, sec: number) => void }) {
  return (
    <div className="p-2">
      <p className="mb-2 text-[11px] text-faint">Added at the playhead on the {kind === "text" ? "Text" : "Effects"} track. Drag the block to move it, its edges to change the length.</p>
      <ul className="flex flex-col gap-1.5">
        {kind === "text"
          ? TEXTS.map((t) => (
              <li key={t.name}>
                <button className="flex w-full items-center justify-between rounded-ctl border border-line bg-surface2 px-2.5 py-2 text-left hover:border-muted" onClick={() => onText(t.text, t.y)}>
                  <span style={{ fontFamily: t.text.font === "serif" ? '"Instrument Serif", Georgia, serif' : undefined, fontWeight: t.text.font === "serif" ? 400 : 800, fontStyle: t.text.font === "serif" ? "italic" : undefined, color: t.text.color, fontSize: 15 }}>{t.text.text}</span>
                  <span className="text-[11px] text-muted">{t.name}</span>
                </button>
              </li>
            ))
          : EFFECTS.map((e) => (
              <li key={e.type}>
                <button className="w-full rounded-ctl border border-line bg-surface2 px-2.5 py-2 text-left hover:border-muted" onClick={() => onEffect(e.type, e.sec)}>
                  <span className="block text-[13px] font-medium">{e.name}</span>
                  <span className="block text-[11px] text-muted">{e.note}</span>
                </button>
              </li>
            ))}
      </ul>
    </div>
  );
}
