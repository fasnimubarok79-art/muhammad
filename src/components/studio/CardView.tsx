"use client";

import { CARD_GRID_STEP, cardLines, type WordCard } from "@/lib/media/cards";

/** Preview of one word card. Sizes are in container-width units of the ASS play space, like the render. */
export function CardView({ card, playW }: { card: WordCard; playW: number }) {
  const u = (px: number) => `${(px / playW) * 100}cqw`;
  const grid = card.style === "grid"
    ? `linear-gradient(90deg, ${card.accent} ${u(2)}, transparent ${u(2)}), linear-gradient(${card.accent} ${u(2)}, transparent ${u(2)})`
    : undefined;
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 ${card.anim === "fade" ? "card-in-fade" : ""}`} style={{ background: card.bg }}>
      {grid && <div className="absolute inset-0" style={{ backgroundImage: grid, backgroundSize: `${u(CARD_GRID_STEP)} ${u(CARD_GRID_STEP)}`, backgroundPosition: `${u(CARD_GRID_STEP)} ${u(CARD_GRID_STEP)}` }} />}
      {(card.style === "grid" || card.style === "paper") && <div className="absolute inset-0" style={{ boxShadow: `inset 0 0 ${u(160)} ${u(40)} rgb(0 0 0 / 0.06)` }} />}
      {card.style === "accent" && <div className="absolute inset-y-0 left-0" style={{ width: "5%", background: card.accent }} />}
      <p
        className={`absolute left-1/2 m-0 whitespace-pre text-center ${card.anim === "pop" ? "card-in-pop" : ""}`}
        style={{
          top: `${card.y * 100}%`,
          transform: "translate(-50%, -50%)",
          fontFamily: card.font === "serif" ? '"Instrument Serif", Georgia, serif' : '"Inter Variable", system-ui, sans-serif',
          fontWeight: card.font === "serif" ? 400 : 900,
          fontStyle: card.italic ? "italic" : "normal",
          fontSize: u(card.size),
          lineHeight: 1.2,
          color: card.color,
        }}
      >
        {cardLines(card, playW).join("\n")}
      </p>
    </div>
  );
}
