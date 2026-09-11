# Odoo Flow Engine Pro (Odoo 17)

A native flowchart and diagram IDE built directly into Odoo. Diagrams are
Odoo records, not attachments or embedded images — they live inside your
database, respect Odoo's security model, and open in a dedicated canvas
editor from their own app menu.

**Author / Copyright holder:** HosamAE
**Depends only on:** `base`, `web` — installs on any Odoo 17 Community
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
  *User* (view/edit existing diagrams) and *Manager* (also create and delete
  diagrams). Access is opt-in per user, not granted to every internal
  employee by default.
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

## Creating a diagram programmatically (`canvas_data` JSON schema)

A diagram's entire visual content lives in one field —
`workflow.diagram.canvas_data` — a JSON string shaped as:

```json
{
  "nodes": [
    {
      "id": "n1",
      "x": 100, "y": 100, "width": 120, "height": 50,
      "type": "start_end",
      "label": "Start",
      "color": "#93c5fd",
      "textColor": "#1e293b",
      "fontSize": "14"
    }
  ],
  "edges": [
    { "id": "e1", "source": "n1", "target": "n2", "label": "" }
  ]
}
```

To create a diagram from code (e.g. an import script, another module,
`odoo-bin shell`), it's enough to `create()` a `workflow.diagram` with a
valid `canvas_data` string — everything else follows automatically:

```python
env['workflow.diagram'].create({
    'name': 'Onboarding Flow',
    'canvas_data': json.dumps({
        'nodes': [
            {'id': 'n1', 'x': 0, 'y': 0, 'width': 120, 'height': 50, 'type': 'start_end', 'label': 'Start'},
            {'id': 'n2', 'x': 0, 'y': 150, 'width': 120, 'height': 50, 'type': 'process', 'label': 'Do Work'},
        ],
        'edges': [
            {'id': 'e1', 'source': 'n1', 'target': 'n2'},
        ],
    }),
})
```

**Node fields** — `id` (any unique string within the diagram), `x`/`y`
(top-left corner, canvas units), `width`/`height`, `type`, `label`. `type`
must be one of the values in `workflow.node`'s `node_type` Selection
(`models/workflow_node.py`):

- `start_end` (oval), `process` (rectangle), `decision` (diamond), `data`
  (parallelogram) — the four standard flowchart shapes.
- `comment`, `triangle`, `pentagon`, `hexagon`, `star`, `trapezoid` — free
  annotation shapes (the long-press shape picker's "Comment" category).
- `text` — a free-floating text label with no background/border.

Optional visual fields the canvas frontend reads but the backend doesn't
validate: `color` (hex fill), `textColor` (hex, auto-derived from `color`
by contrast if omitted), `fontSize`, `isCommentCategory` (true for
annotation shapes so they're excluded from the flowchart compliance
checker), `bgImage` (data URL, per-node background image).

**Edge fields** — `id`, `source`/`target` (must match a node `id` in the
same `nodes` array), `label` (optional, shown on the connector).

`id` values only need to be unique *within* a single diagram's own JSON —
they're not global. Only `id`, `type`, `label` (nodes) and `id`, `source`,
`target`, `label` (edges) are read by the backend sync; everything else is
purely cosmetic and safe to omit (the canvas falls back to sane defaults on
next open, sourced from Settings > Flow Engine Pro).

`workflow.node` / `workflow.edge` are regenerated from this JSON on every
`create()`/`write()` of the parent `workflow.diagram` (see **Data model**
below) — never write to `workflow.node`/`workflow.edge` directly, they'll
just be overwritten on the next save.

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
access.

| Action | User | Manager |
|---|---|---|
| Open the app, view diagrams | Yes | Yes |
| Edit an existing diagram (draw/move/delete shapes, rename, restyle, set a background image) | Yes | Yes |
| Create a new diagram | No | Yes |
| Duplicate a diagram (creates a new record) | No | Yes |
| Delete a diagram | No | Yes |

Editing an existing diagram legitimately adds and removes rows in
`workflow.node` / `workflow.edge` behind the scenes (see **Data model**
below) even though a User has no direct create/unlink access to those two
models — `_sync_canvas_data()` performs that internal sync as `sudo()`
specifically so a User's own edits aren't blocked by it. A User's direct
ACL on `workflow.diagram`/`workflow.node`/`workflow.edge` is read+write
only (`perm_create=0`, `perm_unlink=0`); a Manager has full read/write/
create/unlink on all three.

The module's own Settings page (global appearance defaults) stays gated on
`base.group_system` regardless of these groups, since its action targets
`res.config.settings`, a model Odoo core restricts to System Administrators
across every installed module, not something this module can safely loosen
just for itself.

## Tests

`tests/test_workflow_diagram.py` — node/edge sync on create and update
(including the `text` annotation shape), cross-diagram search, settings
defaults/overrides, and the security groups (a User can edit an existing
diagram's shapes but is blocked from creating or deleting a diagram; a
Manager can do both; a user with neither group is blocked entirely). Run
with:

    odoo-bin -c <conf> -d <db> -u flow_engine_pro --test-enable \
             --test-tags /flow_engine_pro --stop-after-init

Run from PowerShell on Windows — Git Bash rewrites `/flow_engine_pro` into a
filesystem path.

## Requirements

Odoo 17 (Community or Enterprise). No other module dependency beyond `base`
and `web`.

## License

Odoo Proprietary License v1.0 (OPL-1) — see [`LICENSE`](LICENSE) in this
folder for the full plain-language terms. In short: this is paid software
(sometimes discounted for a limited time); a buyer may use it and build on
top of it; nobody may resell it or republish it under another name; all
other rights are reserved.

Copyright (c) 2026 **HosamAE**. All rights reserved beyond the usage grant
described in [`LICENSE`](LICENSE).
