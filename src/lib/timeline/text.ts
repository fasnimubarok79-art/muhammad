import { assColor, assText, assTime } from "../media/subtitles";
import type { Item } from "./schema";

/** Text items (titles) burned in through the same ASS file as subtitles and cards. */
export const TEXT_FONTS = { serif: "Instrument Serif", sans: "Inter Black" } as const;
export const TITLE_STYLE_LINE = "Style: Title,Inter Black,80,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,4,0,5,0,0,0,1";

/** Layer 8: above subtitles (0-1), below word cards (10+). Times in output seconds. */
export function textEvents(items: Array<Item & { startSec: number; durSec: number }>, play = { w: 1080, h: 1920 }): string[] {
  return items
    .filter((i) => i.text)
    .map((i) => {
      const t = i.text!;
      const x = Math.round((i.transform?.x ?? 0.5) * play.w);
      const y = Math.round((i.transform?.y ?? 0.3) * play.h);
      const anim = t.anim === "fade" ? "\\fad(150,150)" : t.anim === "pop" ? "\\fscx125\\fscy125\\t(0,160,\\fscx100\\fscy100)" : "";
      const alpha = i.opacity < 1 ? `\\alpha&H${Math.round((1 - i.opacity) * 255).toString(16).padStart(2, "0").toUpperCase()}&` : "";
      return `Dialogue: 8,${assTime(i.startSec)},${assTime(i.startSec + i.durSec)},Title,,0,0,0,,{\\an5\\pos(${x},${y})\\fn${TEXT_FONTS[t.font]}\\fs${t.size}\\c${assColor(t.color)}\\bord${t.outline}\\3c&H000000&\\shad0${alpha}${anim}}${assText(t.text)}`;
    });
}
