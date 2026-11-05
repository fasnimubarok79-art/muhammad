"use client";

import { type Style } from "./useEditor";
import { HORMOZI_STYLE } from "@/lib/media/subtitles";

/**
 * Effect Controls panel for the active caption style.
 *
 * Lets the user customise the visual effects of the current subtitle preset:
 * active word highlight colour, pop scale (\fscx \\fscy), outline thickness
 * and shadow thickness. Only meaningful for presets that draw per-word
 * highlights (hormozi, impact, punch, pop, karaoke).
 */
export function EffectControls({ style, onStyle }: { style: Style; onStyle: (s: Partial<Style>) => void }) {
  const st = (patch: Partial<Style>) => onStyle({ ...style, ...patch });
  const isHormozi = style.preset === "hormozi";

  return (
    <div className="text-[13px]">
      <div className="border-b border-line px-3 py-3">
        <h3 className="mb-2 font-sans text-[12px] font-semibold uppercase tracking-wide text-faint" style={{ fontStretch: "100%" }}>
          Caption effects
        </h3>
        <p className="text-[12px] text-muted">
          Customise how the active word looks when spoken. Applies to the
          {style.preset} subtitle animation.
        </p>
      </div>

      <div className="px-3 pb-3 space-y-3">
        {/* Active word highlight colour */}
        <div className="flex items-center gap-2">
          <label className="w-32 shrink-0 text-[12px] text-muted">Active word colour</label>
          <input
            id="ef-highlight"
            type="color"
            value={style.highlight}
            onChange={(e) => st({ highlight: e.target.value.toUpperCase() })}
            className="h-7 w-12 rounded bg-surface2"
          />
          <span className="text-[11px] text-faint">{style.highlight}</span>
        </div>

        {/* Pop scale (\fscx / \fscy) */}
        <div className="flex items-center gap-2">
          <label className="w-32 shrink-0 text-[12px] text-muted">Pop scale</label>
          <input
            id="ef-pop-scale"
            type="range"
            min={1}
            max={2}
            step={0.05}
            value={style.popScale}
            onChange={(e) => st({ popScale: Number(e.target.value) })}
            className="w-full accent-[#FF7A1A]"
          />
          <span className="w-16 text-[11px] text-mono tc">{style.popScale.toFixed(2)}×</span>
        </div>
        <p className="-mt-1 text-[11px] text-faint">
          How much the active word scales up when spoken. 1.0 = no pop, 1.35 = default Hormozi pop.
        </p>

        {/* Outline thickness */}
        <div className="flex items-center gap-2">
          <label className="w-32 shrink-0 text-[12px] text-muted">Outline</label>
          <input
            id="ef-outline"
            type="range"
            min={0}
            max={20}
            value={style.outline}
            onChange={(e) => st({ outline: Number(e.target.value) })}
            className="w-full accent-[#FF7A1A]"
          />
          <span className="w-16 text-[11px] text-mono tc">{style.outline}px</span>
        </div>

        {/* Shadow thickness */}
        <div className="flex items-center gap-2">
          <label className="w-32 shrink-0 text-[12px] text-muted">Shadow</label>
          <input
            id="ef-shadow"
            type="range"
            min={0}
            max={12}
            value={style.shadow}
            onChange={(e) => st({ shadow: Number(e.target.value) })}
            className="w-full accent-[#FF7A1A]"
          />
          <span className="w-16 text-[11px] text-mono tc">{style.shadow}px</span>
        </div>
      </div>

      {isHormozi && (
        <div className="px-3 py-2 border-t border-line/50 bg-surface2/40 rounded-ctl text-[12px]">
          <p className="text-muted">Hormozi preset detected — changes apply to the active-word \fscx / \fscy pop animation in the render.</p>
        </div>
      )}
    </div>
  );
}
