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
  crossing or an excessive number of bends. Auto-layout arranges Flow
  shapes into clean, symmetric layers with one click.
- **Real Odoo dark mode**: the canvas and the whole IDE chrome — header,
  footer, toolbar, panels — repaint for dark mode via Odoo's own
  `web.assets_web_dark` bundle, not just the canvas itself. Shape and text
  colors are picked by actual contrast against the fill, not a single
  hardcoded swatch, so a custom dark or light fill still gets readable text.
- **Deep appearance settings, with a live preview**: independent font
  (size/family/color), default shape, and border (style/width/color/on-off)
  for Flow shapes vs. Comment shapes, set globally in Settings or overridden
  per diagram — the Settings page renders a live canvas preview of the
  current choices as you change them.
- **Flowchart compliance checker**: validates a diagram against standard
  flowchart structure (a Start and an End, no orphan shapes, every Decision
  has 2+ distinct labeled branches, only a Decision may branch) and shows a
  quiet checkmark when it passes — details on any issue found live in the
  diagram's own Settings panel.
- **Search & Pulse**: find a shape by name across every diagram from the
  sidebar search box — it opens the right diagram if needed, pans to the
  shape, and pulses it for 3 seconds.
- **Navigator minimap**: a docked, always-in-sync minimap of the current
  diagram; click anywhere on it to recenter the main canvas. Opening a
  diagram (or resetting the view) fits the whole diagram in frame instead
  of defaulting to the world origin.
- **Per-diagram background image**: attach a reference image (a whiteboard
  photo, an existing chart) to any individual diagram from its own Settings
  panel, to trace over.
- **One-click PNG capture** and an **auto-generated thumbnail** saved on
  every diagram record whenever it's saved.
- **Hybrid JSON/SQL storage**: the canvas state is stored as a JSON blob for
  fast frontend loading, while `workflow.node` / `workflow.edge` records are
  kept in sync as a lightweight SQL index — this is also what Search & Pulse
  queries to find a shape without opening every diagram.
- **Native Odoo list/form** (under the app's "Reports" menu) for search,
  filters, and group-by across diagrams, with a "Canvas" button per row to
  jump straight into the editor.
- **Dedicated security groups** under their own "Flow Engine Pro" category:
  *User* (create/edit diagrams) and *Manager* (also delete diagrams). Access
  is opt-in per user, not granted to every internal employee by default.
- Demo data (`demo/demo.xml`) ships three realistic, fully-compliant sample
  diagrams — an onboarding approval flow, an IT ticket triage flow, and an
  expense reimbursement flow — each with a comment note, so a fresh install
  isn't an empty sidebar.

## Data model

`workflow.diagram` holds the canvas as a JSON field (`canvas_data`) plus
per-diagram appearance overrides and a generated `thumbnail`.
`workflow.node` / `workflow.edge` are a search-index shadow of that JSON,
kept in sync on every create/write, scoped to their diagram with
`ondelete='cascade'`. `res.config.settings` carries the global appearance
defaults, each backed by an `ir.config_parameter`.

## Frontend architecture

The canvas editor is an OWL component (`static/src/components/canvas/`)
split into a few focused files: `canvas.js` owns rendering and the
mouse/keyboard interaction state machine; `canvas_routing.js` computes edge
side-assignment and stub-routing geometry; `canvas_layout.js` is the
auto-layout algorithm, a pure function over nodes/edges with no DOM
dependency. `core/math_utils.js` holds the shape-drawing primitives and
geometry helpers shared by all three. `core/flowchart_rules.js` is the
compliance checker, also a pure function.

## Security

Two groups under the "Flow Engine Pro" category (Settings > Users &
Companies > Groups): *User* and *Manager* (Manager implies User). Neither
is granted automatically — an admin assigns one to whichever employees need
access. The module's own Settings page (global appearance defaults) stays
gated on `base.group_system` regardless of these groups, since its action
targets `res.config.settings`, a model Odoo core restricts to System
Administrators across every installed module, not something this module
can safely loosen just for itself.

## Tests

`tests/test_workflow_diagram.py` — node/edge sync on create and update,
cross-diagram search, settings defaults/overrides, and the security groups
(a User blocked from delete, a Manager allowed, a user with neither group
blocked entirely). Run with:

    odoo-bin -c <conf> -d <db> -u flow_engine_pro --test-enable \
             --test-tags /flow_engine_pro --stop-after-init

Run from PowerShell on Windows — Git Bash rewrites `/flow_engine_pro` into a
filesystem path.

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
