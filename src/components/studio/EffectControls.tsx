"use client";

import { type Style } from "./useEditor";
import { HORMOZI_STYLE } from "@/lib/media/subtitles";

/**
 * Effect Controls panel for the active caption style and visual polish.
 *
 * Lets the user customise the visual effects of the current subtitle preset:
 * active word highlight colour, pop scale (\fscx \\fscy), outline thickness
 * and shadow thickness. Only meaningful for presets that draw per-word
 * highlights (hormozi, impact, punch, pop, karaoke).
 *
 * Also exposes visual polish controls: background colour for fit+blur/pad
 * framing and a watermark image overlay drawn over the render.
 */
export type WatermarkInput = { input: number; x: number; y: number; scale: number; opacity: number };

export function EffectControls({
  style,
  onStyle,
  bgColor,
  onBgColor,
  watermark,
  onWatermark,
}: {
  style: Style;
  onStyle: (s: Partial<Style>) => void;
  bgColor: string;
  onBgColor: (v: string) => void;
  watermark: WatermarkInput | undefined;
  onWatermark: (v: WatermarkInput | null) => void;
}) {
  const st = (patch: Partial<Style>) => onStyle({ ...style, ...patch });
  const isHormozi = style.preset === "hormozi";

  return (
    <div className="text-[13px]">
      <div className="border-b border-line px-3 py-3">
        <h3 className="mb-2 font-sans text-[12px] font-semibold uppercase tracking-wide text-faint" style={{ fontStretch: "100%" }}>
          Caption effects
        </h3>
        <p className="text-[12px] text-muted">
          Customise how the active word looks when spoken. Applies to the{" "}
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

      <div className="border-t border-line/50 px-3 py-3 space-y-3">
        <h3 className="mb-2 font-sans text-[12px] font-semibold uppercase tracking-wide text-faint" style={{ fontStretch: "100%" }}>
          Visual polish
        </h3>
        <p className="text-[12px] text-muted">Background colour and watermark for the rendered export.</p>

        {/* Background colour */}
        <div className="flex items-center gap-2">
          <label className="w-32 shrink-0 text-[12px] text-muted">Background colour</label>
          <input
            id="ef-bg-color"
            type="color"
            value={bgColor}
            onChange={(e) => onBgColor(e.target.value.toUpperCase())}
            className="h-7 w-12 rounded bg-surface2"
          />
          <span className="text-[11px] text-faint">{bgColor}</span>
        </div>
        <p className="-mt-1 text-[11px] text-faint">
          Fill colour for empty areas when framing is Fit+blur or Bars. Applied at render time.
        </p>

        {/* Watermark toggle */}
        <div className="flex items-center gap-2">
          <label className="w-32 shrink-0 text-[12px] text-muted">Watermark</label>
          <button
            id="ef-watermark-toggle"
            className={`btn-secondary h-7 px-2 text-[12px] ${watermark ? "bg-edit text-bg" : "text-muted hover:text-ink"}`}
            onClick={() => onWatermark(watermark ? null : { input: 0, x: 0.95, y: 0.95, scale: 0.15, opacity: 0.6 })}
          >
            {watermark ? "Remove watermark" : "Add watermark image"}
          </button>
        </div>

        {watermark && (
          <div className="space-y-1 pl-36">
            <div className="flex items-center gap-2">
              <label className="w-32 shrink-0 text-[12px] text-muted">Position X</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={watermark.x}
                onChange={(e) => onWatermark({ ...watermark, x: Number(e.target.value) })}
                className="w-full accent-[#FF7A1A]"
              />
              <span className="w-16 text-[11px] text-mono tc">{watermark.x.toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="w-32 shrink-0 text-[12px] text-muted">Position Y</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={watermark.y}
                onChange={(e) => onWatermark({ ...watermark, y: Number(e.target.value) })}
                className="w-full accent-[#FF7A1A]"
              />
              <span className="w-16 text-[11px] text-mono tc">{watermark.y.toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="w-32 shrink-0 text-[12px] text-muted">Scale</label>
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.01}
                value={watermark.scale}
                onChange={(e) => onWatermark({ ...watermark, scale: Number(e.target.value) })}
                className="w-full accent-[#FF7A1A]"
              />
              <span className="w-16 text-[11px] text-mono tc">{watermark.scale.toFixed(2)}×</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="w-32 shrink-0 text-[12px] text-muted">Opacity</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={watermark.opacity}
                onChange={(e) => onWatermark({ ...watermark, opacity: Number(e.target.value) })}
                className="w-full accent-[#FF7A1A]"
              />
              <span className="w-16 text-[11px] text-mono tc">{watermark.opacity.toFixed(2)}</span>
            </div>
          </div>
        )}
      </div>

      {isHormozi && (
        <div className="px-3 py-2 border-t border-line/50 bg-surface2/40 rounded-ctl text-[12px]">
          <p className="text-muted">Hormozi preset detected — changes apply to the active-word \fscx / \fscy pop animation in the render.</p>
        </div>
      )}
    </div>
  );
}
