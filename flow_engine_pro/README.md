# Odoo Flow Engine Pro (Odoo 19)

A native flowchart and diagram IDE built directly into Odoo. Diagrams are
Odoo records, not attachments or embedded images — they live inside your
database, respect Odoo's security model, and open in a dedicated canvas
editor from their own app menu.

**Author / Copyright holder:** HosamAE
**Depends only on:** `base`, `web` — installs on any Odoo 19 Community
database, no other Highnox or third-party module required.

## What the buyer gets

- **Smart orthogonal routing**: connectors auto-attach to the cleanest side
  of each shape (top/bottom/left/right), route around obstacles, and are
  built to never cross a flow shape — a longer path is preferred over a
  crossing or an excessive number of bends.
- **Real Odoo dark mode**: the canvas itself — line colors, fills, text —
  repaints for dark mode via Odoo's own `web.assets_web_dark` bundle, not
  just the surrounding toolbar chrome.
- **Deep appearance settings, with a live preview**: independent font
  (size/family/color), default shape, and border (style/width/color/on-off)
  for Flow shapes vs. Comment shapes, set globally in Settings or overridden
  per diagram — the Settings page renders a live canvas preview of the
  current choices as you change them.
- **Navigator minimap**: a docked, always-in-sync minimap of the current
  diagram; click anywhere on it to recenter the main canvas.
- **Per-diagram background image**: attach a reference image (a whiteboard
  photo, an existing chart) to any individual diagram from its own menu, to
  trace over.
- **One-click PNG capture** and an **auto-generated thumbnail** saved on
  every diagram record whenever it's saved.
- **Hybrid JSON/SQL storage**: the canvas state is stored as a JSON blob for
  fast frontend loading, while `workflow.node` / `workflow.edge` records are
  kept in sync as a lightweight SQL index so nodes participate in Odoo's
  ordinary model search.
- **Odoo-native security**: standard `ir.model.access.csv` and `ir.rule`
  records — no bespoke permission system.
- Demo data (`demo/demo.xml`) ships a ready-made "Employee Onboarding"
  approval flow so a fresh install isn't an empty sidebar.

## Data model

`workflow.diagram` holds the canvas as a JSON field (`canvas_data`) plus
per-diagram appearance overrides and a generated `thumbnail`.
`workflow.node` / `workflow.edge` are a search-index shadow of that JSON,
kept in sync on save, scoped to their diagram with `ondelete='cascade'`.
`res.config.settings` carries the global appearance defaults, each backed by
an `ir.config_parameter`.

## Requirements

Odoo 19 (Community or Enterprise). No other module dependency beyond `base`
and `web`.

## License

Odoo Proprietary License v1.0 (OPL-1) — see [`LICENSE`](LICENSE) in this
folder for the full plain-language terms. In short: this is paid software
(sometimes discounted for a limited time); a buyer may use it and build on
top of it; nobody may resell it or republish it under another name; all
other rights are reserved.

Copyright (c) 2026 **HosamAE**. All rights reserved beyond the usage grant
described in [`LICENSE`](LICENSE).
