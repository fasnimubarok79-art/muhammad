# DESIGN.md

Direction for every UI built in this project. Agents read this file for direction first, then run the `antislop` skill as the filter.

Dial: ENERGY 2 / RHYTHM 2 / MOTION 1

> Working name for the visual language: **Ledger**. An editorial, paper-and-ink system: warm off-white paper, near-black ink, one rust accent, hairline rules. It is an original direction, not a copy of any brand in `awesome-design-md`. Product name, logo and real content are still open and must come from the owner, never invented.

## Overview

- **Character:** calm and confident, like a well-set printed report. It reads as considered, not trendy.
- **Identity motif:** hairline rules (1px) with a small numbered margin label (`01`, `02`) marking each major section. It is used consistently and is the one thing that makes the UI recognisable.
- **Focal point:** each screen has exactly one primary element. The rust accent marks it and nothing else competes.
- **Theme:** light by default (paper). Dark ("night ink") is supported through `prefers-color-scheme` and a manual toggle. It is not the default.

## Colors

All text pairs below were measured with `.claude/skills/antislop-human/contrast-check.py` (WCAG 2.x).

| Token | Light | Dark | Use | Contrast (text on bg) |
|---|---|---|---|---|
| `--paper` | `#F5F2EA` | `#15140F` | Page background | n/a |
| `--surface` | `#FBFAF6` | `#1E1D18` | Raised surfaces: inputs, dialogs, menus | n/a |
| `--ink` | `#1B1A17` | `#ECE8DE` | Body and headings | 15.56:1 / 15.07:1 |
| `--ink-muted` | `#5E5A52` | `#A39E92` | Secondary text, captions | 6.13:1 / 6.90:1 |
| `--rule` | `#D9D3C5` | `#34322B` | Hairlines, dividers (decorative) | n/a |
| `--line-strong` | `#8A8478` | `#6B675D` | Input borders and other non-text UI only. **Never text** (3.32:1) | 3:1 non-text |
| `--accent` | `#B4400F` | `#F07A45` | Primary action, focus ring, the one focal mark | 5.10:1 / 6.65:1 |
| `--on-accent` | `#FFFFFF` | `#15140F` | Text on accent fills | 5.71:1 / 6.65:1 |
| `--success` | `#2F6B3F` | `#7FB98E` | Confirmed states | 5.70:1 |
| `--danger` | `#A3231B` | `#F08A80` | Errors, destructive actions | 6.67:1 |

Rules:
- One accent only. It is not used for decoration, icons or backgrounds of whole sections.
- No gradients, glows, glassmorphism, mesh or grid backgrounds.
- Dark-mode values for `--success`, `--danger` and `--line-strong` must be re-measured once they are used on real surfaces.

```css
:root {
  --paper:#F5F2EA; --surface:#FBFAF6; --ink:#1B1A17; --ink-muted:#5E5A52;
  --rule:#D9D3C5; --line-strong:#8A8478; --accent:#B4400F; --on-accent:#FFFFFF;
  --success:#2F6B3F; --danger:#A3231B;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --paper:#15140F; --surface:#1E1D18; --ink:#ECE8DE; --ink-muted:#A39E92;
    --rule:#34322B; --line-strong:#6B675D; --accent:#F07A45; --on-accent:#15140F;
    --success:#7FB98E; --danger:#F08A80;
  }
}
:root[data-theme="dark"] { /* same values as the dark block above */ }
```

## Typography

| Role | Family | Why |
|---|---|---|
| Display (H1 and H2) | **Bricolage Grotesque** (variable, 600 to 700) | Slightly irregular grotesque. It gives warmth and identity without being a novelty face. |
| Text and UI | **Source Sans 3** (400, 600) | Highly legible at small sizes, neutral next to the display face, and has a wide language range (Indonesian included). |
| Numbers and data | Source Sans 3 with `font-variant-numeric: tabular-nums` | Aligned columns without introducing a monospace look. |

Scale (fluid, 1.25 ratio): `--step--1: .8rem`, `--step-0: 1rem`, `--step-1: 1.25rem`, `--step-2: 1.563rem`, `--step-3: clamp(1.75rem, 1.2rem + 2.2vw, 2.441rem)`, `--step-4: clamp(2.2rem, 1.4rem + 3.6vw, 3.815rem)`.

- Body line-height 1.55, headings 1.1. Measure 60 to 72ch.
- Headings use sentence case. No all-caps headings with wide tracking. No monospace headings.
- Margin labels (the motif) use `--step--1`, weight 600, `--ink-muted`, tabular numbers.

## Layout

- Base unit 4px. Spacing scale: 4, 8, 12, 16, 24, 32, 48, 72, 112.
- Spacing is **not** uniform. Spacing inside a group is tight (8 to 16). Spacing between groups is generous (48 to 112). Each section picks its spacing from its content.
- 12-column grid, max content width 72rem, gutter `clamp(16px, 4vw, 32px)`.
- RHYTHM 2: sections share the grid, but at least every third section breaks the pattern (offset column, full-bleed rule, different density). No section repeats the exact "title + subtitle + identical cards" composition.
- Mobile first. No horizontal scroll at 320px. Tap targets of at least 44×44px.

## Elevation & Depth

- Depth comes from **rules and surface tone**, not shadows.
- Level 0: `--paper`. Level 1: `--surface` + 1px `--rule` border. Level 2 (menus, dialogs only): `--surface` + `0 1px 2px rgb(0 0 0 / .06), 0 8px 24px rgb(0 0 0 / .08)`.
- No glow, no blur behind navigation.

## Shapes

- Radius: `--r-sm: 4px` (inputs, buttons), `--r-md: 8px` (cards, dialogs). No pill shapes, except avatars and toggle tracks, where the shape is functional.
- Borders are 1px hairlines. No decorative colored left stripe.

## Components

- **Button primary:** `--accent` fill, `--on-accent` text, `--r-sm`, 44px min height. At most one per view.
- **Button secondary:** transparent, 1px `--line-strong` border, `--ink` text.
- **Link:** `--ink` with an underline of 1px offset 3px. On hover the underline turns `--accent`.
- **Input:** `--surface`, 1px `--line-strong`, visible label above (never placeholder-only). Error text in `--danger` placed below the field, with `aria-describedby`.
- **Focus:** `outline: 2px solid var(--accent); outline-offset: 2px` on `:focus-visible` for every interactive element.
- **States are required** for every data view: empty, loading, error and populated, and long-content cases (test with the `break-ui` skill).
- **Icons:** pick one set on purpose and use it sparingly, only where the icon adds meaning. Not sparkles, robots or decorative arrows on every button.
- **Library choice:** run `pick-ui-library` before hand-rolling toasts, menus, OTP inputs and similar. If the stack is React + Tailwind + shadcn, components from 21st.dev may be used, but they must be restyled to these tokens.

## Motion

MOTION 1. Motion confirms an action, it does not decorate.

- Easing: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`. For on-screen movement use `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)`.
- Durations: 120ms (hover and press), 180ms (popover and menu), 240ms (dialog). Nothing above 300ms in UI.
- Animate only `transform` and `opacity`. Enter from `scale(.97)` + opacity, never from `scale(0)`.
- No animation on keyboard-triggered actions or on high-frequency surfaces. No scroll-reveal fade-ups.
- `@media (prefers-reduced-motion: reduce)`: remove movement and keep opacity changes only.
- Review all motion with `review-animations`. Check performance with `animation-performance`.

## Do's and Don'ts

Do:
- State the Design Read before building: *Reading this as: `<page kind>` for `<audience>`, Ledger style, dial ENERGY 2 / RHYTHM 2 / MOTION 1.*
- Use real content from the owner. Mark gaps visibly as `TODO(content)`.
- Write specific CTAs that say what happens ("Kirim laporan", "Lihat tagihan Mei").

Don't:
- Blue-to-purple gradients, glow, bento grids, fake terminal heroes, or a "trusted by" logo bar.
- Fake stats, testimonials, avatars, logos or compliance claims.
- Em dashes in UI copy. Buzzwords such as "seamless", "revolutionary" or "AI-powered".
- Copy the look of a brand from `awesome-design-md` (Linear, Vercel, Stripe and others). Those files are format references only.

## Responsive Behavior

- Breakpoints: 480, 768, 1024, 1280 (min-width).
- Below 768px, the margin-label motif moves above the section heading instead of sitting in the margin.
- Navigation collapses to a disclosure button with `aria-expanded`. Do not use a hamburger icon alone without a text label.
- Apply the `mobile-native` skill for safe areas, `100dvh`, input zoom and tap highlight.

## Iteration Guide

1. Changing the accent: pick a new value, re-run the contrast checker against `--paper`, `--surface` and `--on-accent`, then update the table.
2. Raising energy for a marketing page: change the Dial line here (for example ENERGY 3 / RHYTHM 3 / MOTION 2) for that page only and note why.
3. Keep this file the single source of truth. Code tokens must mirror it, not the other way around.

## Known Gaps

- No product brief yet: name, audience, logo and real copy are unknown. Until they exist, any page built is a *draft without direction* for content.
- No framework chosen. The tokens above are plain CSS custom properties, so they work with any stack.
- Fonts are not yet self-hosted. Load them with `font-display: swap` and a subset when the stack is chosen.
