# CLAUDE.md

## UI work: direction, then filter
1. Read `DESIGN.md` (direction, tokens, Dial line). It is the single source of truth.
2. Apply the `antislop` skill as the filter. Use antislop in **during** mode for this project, and do not ask the mode question.
3. Before building, state one line: `Reading this as: <page kind> for <audience>, Ledger style, dial <from DESIGN.md>.`

## Skill routing (load only what the task needs)
| Task | Skills |
|---|---|
| Any UI build or edit | `antislop` + `antislop-ui` |
| Accessibility, contrast, focus | `antislop-human` (contrast: `python3 .claude/skills/antislop-human/contrast-check.py "#fg" "#bg"`) |
| Responsive or mobile web | `antislop-layoutmobile`, then `mobile-native` |
| UI copy and text | `antislop-copywriting` |
| Cleaning code comments | `antislop-code` |
| Polish and component craft | `emil-design-eng` |
| New animation | `animate`; review with `review-animations`; jank with `animation-performance` |
| Stress-test a component | `break-ui` |
| Choosing a library | `pick-ui-library` (21st.dev components only for React + Tailwind + shadcn) |
| Comparing UI variants | `prototype` |

Precedence on conflicts: `DESIGN.md` > `antislop` hard-gate rules > Emil skills.

## Cost and context rules
- Do not load every skill at once. Pick at most 2 to 3 skills per task from the table.
- Read reference files (`references/*.md`, `RECIPES.md`, `STANDARDS.md`) only when a rule points to them.
- The 21st MCP (`.mcp.json`) is optional and needs `API_KEY_21ST`. Use `21st search` before `21st generate`, because generate spends paid quota.
- `awesome-design-md` is used as a format reference only and is not vendored here. Never copy a brand's look.

## Maintenance
- Skills are pinned in `skills-lock.json`. Update with `npx skills update -p`, then review the diff.
