from odoo import models, fields

SHAPE_SELECTION = [
    ('comment', 'Speech Bubble'),
    ('rect', 'Rectangle'),
    ('triangle', 'Triangle'),
    ('pentagon', 'Pentagon'),
    ('hexagon', 'Hexagon'),
    ('star', 'Star'),
    ('trapezoid', 'Trapezoid'),
]

FLOW_SHAPE_SELECTION = [
    ('start_end', 'Oval (Start/End)'),
    ('process', 'Rectangle (Process)'),
    ('decision', 'Diamond (Decision)'),
    ('data', 'Parallelogram (I/O)'),
]

ARROW_STYLE_SELECTION = [
    ('triangle', 'Modern Triangle'),
    ('notch', 'Concave Notch'),
]

BORDER_STYLE_SELECTION = [
    ('dashed', 'Dashed'),
    ('dotted', 'Dotted'),
    ('solid', 'Solid'),
]

BG_STYLE_SELECTION = [
    ('dots', 'Dot Grid'),
    ('grid', 'Line Grid'),
    ('plain', 'Plain'),
]

FONT_FAMILY_SELECTION = [
    ('sans-serif', 'Sans Serif (default)'),
    ('serif', 'Serif'),
    ('monospace', 'Monospace'),
    ("'Trebuchet MS', sans-serif", 'Trebuchet'),
    ('Georgia, serif', 'Georgia'),
    ("'Courier New', monospace", 'Courier New'),
]


class ResConfigSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    # Not stored, no config_parameter - exists purely to give the
    # `flow_appearance_preview` JS widget (see static/src/settings/) a
    # field to attach to in the view. The widget itself reads every other
    # field's live value straight off the form record, so this one never
    # needs a real value of its own.
    flow_preview_placeholder = fields.Char(string='Live Preview', store=False)

    # ── Defaults for newly-created shapes ───────────────────────────────
    flow_default_shape = fields.Selection(
        FLOW_SHAPE_SELECTION, string='Default Flow Shape', default='process',
        config_parameter='flow_engine_pro.default_flow_shape')
    flow_default_comment_shape = fields.Selection(
        SHAPE_SELECTION, string='Default Comment Shape', default='comment',
        config_parameter='flow_engine_pro.default_comment_shape')
    flow_default_shape_width = fields.Integer(
        string='Default Shape Width', default=120,
        config_parameter='flow_engine_pro.default_shape_width')
    flow_default_shape_height = fields.Integer(
        string='Default Shape Height', default=50,
        config_parameter='flow_engine_pro.default_shape_height')
    flow_longpress_duration_ms = fields.Integer(
        string='Long-Press Duration (ms)', default=550,
        config_parameter='flow_engine_pro.longpress_duration_ms')

    # ── Flow shape typography ────────────────────────────────────────────
    flow_default_font_size = fields.Integer(
        string='Flow Font Size', default=14,
        config_parameter='flow_engine_pro.default_font_size')
    flow_font_family = fields.Selection(
        FONT_FAMILY_SELECTION, string='Flow Font', default='sans-serif',
        config_parameter='flow_engine_pro.flow_font_family')

    # ── Comment shape typography ─────────────────────────────────────────
    comment_font_size = fields.Integer(
        string='Comment Font Size', default=14,
        config_parameter='flow_engine_pro.comment_font_size')
    comment_font_family = fields.Selection(
        FONT_FAMILY_SELECTION, string='Comment Font', default='sans-serif',
        config_parameter='flow_engine_pro.comment_font_family')
    # No default on purpose - blank means "follow the light/dark theme",
    # same reasoning as flow_line_color below.
    comment_font_color = fields.Char(
        string='Comment Text Color', help='Leave blank to follow the light/dark theme automatically.',
        config_parameter='flow_engine_pro.comment_font_color')

    # ── Connector lines ───────────────────────────────────────────────────
    # No default on purpose: blank means "follow the Odoo light/dark theme"
    # (see workflow.diagram.get_effective_settings() and canvas.js's
    # `settings` getter) - a hardcoded hex here would get written to
    # ir.config_parameter the first time anyone just opens and saves this
    # page, permanently pinning the canvas to a light-mode colour.
    flow_line_color = fields.Char(
        string='Line Color', help='Leave blank to follow the light/dark theme automatically.',
        config_parameter='flow_engine_pro.line_color')
    flow_line_width = fields.Float(
        string='Line Thickness (px)', default=2.5,
        config_parameter='flow_engine_pro.line_width')
    flow_arrow_style = fields.Selection(
        ARROW_STYLE_SELECTION, string='Arrow Head Style', default='triangle',
        config_parameter='flow_engine_pro.arrow_style')

    # ── Flow shape border ─────────────────────────────────────────────────
    flow_border_enabled = fields.Boolean(
        string='Flow Shape Border Enabled', default=True,
        config_parameter='flow_engine_pro.flow_border_enabled')
    flow_border_style = fields.Selection(
        BORDER_STYLE_SELECTION, string='Flow Shape Border Style', default='solid',
        config_parameter='flow_engine_pro.flow_border_style')
    # Blank = each shape keeps its own per-type default stroke colour
    # (blue outline on a blue Process box, yellow on a yellow Decision
    # diamond, etc.) - the long-standing look. Set a colour here to force
    # every Flow shape to the same border colour instead.
    flow_border_color = fields.Char(
        string='Flow Shape Border Color', help="Leave blank to keep each shape's own outline colour.",
        config_parameter='flow_engine_pro.flow_border_color')
    flow_border_width = fields.Float(
        string='Flow Shape Border Width (px)', default=1,
        config_parameter='flow_engine_pro.flow_border_width')

    # ── Comment shape border ──────────────────────────────────────────────
    comment_border_enabled = fields.Boolean(
        string='Comment Shape Border Enabled', default=True,
        config_parameter='flow_engine_pro.comment_border_enabled')
    flow_comment_border_style = fields.Selection(
        BORDER_STYLE_SELECTION, string='Comment Border Style', default='dashed',
        config_parameter='flow_engine_pro.comment_border_style')
    comment_border_color = fields.Char(
        string='Comment Shape Border Color', help="Leave blank to keep each shape's own outline colour.",
        config_parameter='flow_engine_pro.comment_border_color')
    comment_border_width = fields.Float(
        string='Comment Shape Border Width (px)', default=1,
        config_parameter='flow_engine_pro.comment_border_width')

    # ── Canvas ─────────────────────────────────────────────────────────────
    flow_canvas_bg_style = fields.Selection(
        BG_STYLE_SELECTION, string='Canvas Background Style', default='dots',
        config_parameter='flow_engine_pro.canvas_bg_style')
    # Same "blank = follow the theme" reasoning as flow_line_color above.
    flow_canvas_bg_color = fields.Char(
        string='Canvas Background Color', help='Leave blank to follow the light/dark theme automatically.',
        config_parameter='flow_engine_pro.canvas_bg_color')

    # ── Capture ────────────────────────────────────────────────────────────
    flow_capture_local_download = fields.Boolean(
        string='Capture Also Downloads Locally', default=True,
        config_parameter='flow_engine_pro.capture_local_download')

    # ── Search ─────────────────────────────────────────────────────────────
    # Two independent search tools, each switchable on its own (user
    # request 2026-09-10): the sidebar one searches shape names across
    # EVERY diagram (jumps + pulses the first match, and annotates each
    # diagram row with how many of its shapes match); the header one is
    # scoped to only the diagram currently open, and highlights every
    # match in it instead of jumping anywhere.
    flow_enable_sidebar_search = fields.Boolean(
        string='Sidebar Search (across all diagrams)', default=True,
        config_parameter='flow_engine_pro.enable_sidebar_search')
    flow_enable_header_search = fields.Boolean(
        string='Diagram Search (current diagram only)', default=True,
        config_parameter='flow_engine_pro.enable_header_search')
