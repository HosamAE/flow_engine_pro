from odoo import models, fields, api
from .res_config_settings import (
    SHAPE_SELECTION, FLOW_SHAPE_SELECTION, ARROW_STYLE_SELECTION,
    BORDER_STYLE_SELECTION, BG_STYLE_SELECTION, FONT_FAMILY_SELECTION,
)

# Every override_* field on the model below is left blank/0 by default,
# meaning "use the global default from Settings > Flow Engine Pro" - see
# get_effective_settings(). Maps each settings key (as used in the merged
# dict returned to the JS) to its per-diagram override field name - the
# two don't all share the same suffix (e.g. 'default_comment_shape' vs.
# the field 'override_comment_shape').
OVERRIDE_FIELD_BY_KEY = {
    'default_flow_shape': 'override_flow_shape',
    'default_comment_shape': 'override_comment_shape',
    'default_shape_width': 'override_shape_width',
    'default_shape_height': 'override_shape_height',
    'longpress_duration_ms': 'override_longpress_duration_ms',
    'default_font_size': 'override_font_size',
    'flow_font_family': 'override_flow_font_family',
    'comment_font_size': 'override_comment_font_size',
    'comment_font_family': 'override_comment_font_family',
    'comment_font_color': 'override_comment_font_color',
    'line_color': 'override_line_color',
    'line_width': 'override_line_width',
    'arrow_style': 'override_arrow_style',
    'flow_border_enabled': 'override_flow_border_enabled',
    'flow_border_style': 'override_flow_border_style',
    'flow_border_color': 'override_flow_border_color',
    'flow_border_width': 'override_flow_border_width',
    'comment_border_enabled': 'override_comment_border_enabled',
    'comment_border_style': 'override_comment_border_style',
    'comment_border_color': 'override_comment_border_color',
    'comment_border_width': 'override_comment_border_width',
    'canvas_bg_style': 'override_canvas_bg_style',
    'canvas_bg_color': 'override_canvas_bg_color',
}

# Override fields whose "unset" sentinel is False (not 0/''), so
# get_effective_settings() must check `is False` instead of falsy - a
# real Boolean override of "off" is a valid, meaningful value, not an
# absence of one the way 0 or '' is for the other override fields.
_BOOLEAN_OVERRIDE_KEYS = {'flow_border_enabled', 'comment_border_enabled'}


class WorkflowDiagram(models.Model):
    _name = 'workflow.diagram'
    _description = 'Workflow Diagram Canvas'
    _order = 'sequence, id desc'

    name = fields.Char(string='Diagram Name', required=True)
    sequence = fields.Integer(string='Sequence', default=10)
    canvas_data = fields.Text(string='JSON Canvas Data', default='{}',
        help="Main JSON blob storing the state of the canvas (nodes, edges, positions).")

    node_ids = fields.One2many('workflow.node', 'diagram_id', string='Nodes')
    edge_ids = fields.One2many('workflow.edge', 'diagram_id', string='Edges')

    active = fields.Boolean(default=True)
    company_id = fields.Many2one('res.company', string='Company', default=lambda self: self.env.company)

    # The diagram's one always-current PNG snapshot - see save_snapshot().
    # attachment=True stores it as a regular ir.attachment under the hood
    # while still giving this model the standard
    # /web/image/workflow.diagram/<id>/thumbnail URL for free.
    thumbnail = fields.Binary(string='Snapshot', attachment=True)

    # ── Per-diagram display overrides ──────────────────────────────────
    # Left unset (blank/0/False-as-"unset") by default so they fall back
    # to the global Settings > Flow Engine Pro values - see
    # get_effective_settings(). The two Boolean ones (*_border_enabled)
    # use a 3-state Selection instead of a plain Boolean, since a plain
    # Boolean can't represent "not overridden" separately from "overridden
    # to False".
    override_flow_shape = fields.Selection(FLOW_SHAPE_SELECTION, string='Default Flow Shape')
    override_comment_shape = fields.Selection(SHAPE_SELECTION, string='Comment Shape')
    override_shape_width = fields.Integer(string='Shape Width')
    override_shape_height = fields.Integer(string='Shape Height')
    override_longpress_duration_ms = fields.Integer(string='Long-Press Duration (ms)')
    override_font_size = fields.Integer(string='Flow Font Size')
    override_flow_font_family = fields.Selection(FONT_FAMILY_SELECTION, string='Flow Font')
    override_comment_font_size = fields.Integer(string='Comment Font Size')
    override_comment_font_family = fields.Selection(FONT_FAMILY_SELECTION, string='Comment Font')
    override_comment_font_color = fields.Char(string='Comment Text Color')
    override_line_color = fields.Char(string='Line Color')
    override_line_width = fields.Float(string='Line Thickness (px)')
    override_arrow_style = fields.Selection(ARROW_STYLE_SELECTION, string='Arrow Head Style')
    override_flow_border_enabled = fields.Selection(
        [('true', 'On'), ('false', 'Off')], string='Flow Shape Border')
    override_flow_border_style = fields.Selection(BORDER_STYLE_SELECTION, string='Flow Shape Border Style')
    override_flow_border_color = fields.Char(string='Flow Shape Border Color')
    override_flow_border_width = fields.Float(string='Flow Shape Border Width (px)')
    override_comment_border_enabled = fields.Selection(
        [('true', 'On'), ('false', 'Off')], string='Comment Shape Border')
    override_comment_border_style = fields.Selection(BORDER_STYLE_SELECTION, string='Comment Border Style')
    override_comment_border_color = fields.Char(string='Comment Shape Border Color')
    override_comment_border_width = fields.Float(string='Comment Shape Border Width (px)')
    override_canvas_bg_style = fields.Selection(BG_STYLE_SELECTION, string='Canvas Background Style')
    override_canvas_bg_color = fields.Char(string='Canvas Background Color')

    def get_effective_settings(self):
        """Merges this diagram's overrides on top of the global Flow Engine
        Pro settings (ir.config_parameter) - called from the Flow IDE (JS)
        once per diagram load. A blank/0 override means "use the global
        default", never a real value of 0/"" on purpose."""
        self.ensure_one()
        icp = self.env['ir.config_parameter'].sudo()
        defaults = {
            'default_flow_shape': icp.get_param('flow_engine_pro.default_flow_shape', 'process'),
            'default_comment_shape': icp.get_param('flow_engine_pro.default_comment_shape', 'comment'),
            'default_shape_width': int(icp.get_param('flow_engine_pro.default_shape_width', 120) or 120),
            'default_shape_height': int(icp.get_param('flow_engine_pro.default_shape_height', 50) or 50),
            'longpress_duration_ms': int(icp.get_param('flow_engine_pro.longpress_duration_ms', 550) or 550),
            'default_font_size': int(icp.get_param('flow_engine_pro.default_font_size', 14) or 14),
            'flow_font_family': icp.get_param('flow_engine_pro.flow_font_family', 'sans-serif'),
            'comment_font_size': int(icp.get_param('flow_engine_pro.comment_font_size', 14) or 14),
            'comment_font_family': icp.get_param('flow_engine_pro.comment_font_family', 'sans-serif'),
            # comment_font_color/line_color/canvas_bg_color deliberately
            # fall back to '' (not a literal hex) when never explicitly
            # configured - '' tells the canvas to derive the colour from
            # the current Odoo theme (light/dark) instead of hardcoding
            # light-mode colours that would look wrong once dark mode is
            # on. See canvas.js's `settings` getter, which resolves ''
            # against the page's own CSS variables.
            'comment_font_color': icp.get_param('flow_engine_pro.comment_font_color', ''),
            'line_color': icp.get_param('flow_engine_pro.line_color', ''),
            'line_width': float(icp.get_param('flow_engine_pro.line_width', 2.5) or 2.5),
            'arrow_style': icp.get_param('flow_engine_pro.arrow_style', 'triangle'),
            'flow_border_enabled': icp.get_param('flow_engine_pro.flow_border_enabled', 'True') == 'True',
            'flow_border_style': icp.get_param('flow_engine_pro.flow_border_style', 'solid'),
            # Blank = each Flow shape keeps its own per-type default
            # stroke colour instead of one forced colour - see the field's
            # help text in res_config_settings.py.
            'flow_border_color': icp.get_param('flow_engine_pro.flow_border_color', ''),
            'flow_border_width': float(icp.get_param('flow_engine_pro.flow_border_width', 1) or 1),
            'comment_border_enabled': icp.get_param('flow_engine_pro.comment_border_enabled', 'True') == 'True',
            'comment_border_style': icp.get_param('flow_engine_pro.comment_border_style', 'dashed'),
            'comment_border_color': icp.get_param('flow_engine_pro.comment_border_color', ''),
            'comment_border_width': float(icp.get_param('flow_engine_pro.comment_border_width', 1) or 1),
            'canvas_bg_style': icp.get_param('flow_engine_pro.canvas_bg_style', 'dots'),
            'canvas_bg_color': icp.get_param('flow_engine_pro.canvas_bg_color', ''),
            # Global only - a browser-download preference, not diagram
            # content, so no per-diagram override for this one.
            'capture_local_download': icp.get_param('flow_engine_pro.capture_local_download', 'True') == 'True',
        }
        for key, field_name in OVERRIDE_FIELD_BY_KEY.items():
            value = self[field_name]
            if key in _BOOLEAN_OVERRIDE_KEYS:
                if value:  # '' (unset) is falsy; 'true'/'false' both mean "overridden"
                    defaults[key] = value == 'true'
            elif value:
                defaults[key] = value
        return defaults

    def save_snapshot(self, base64_png):
        """Saves (or overwrites) this diagram's one internal PNG snapshot -
        called from the Flow IDE both after every save ("end of workshop")
        and from the Capture button. `thumbnail` is a plain Binary field
        (attachment=True), so Odoo manages the single backing ir.attachment
        itself - writing it again just replaces that attachment's content,
        never creating a second one - and the standard
        /web/image/workflow.diagram/<id>/thumbnail URL comes for free,
        which is what the flow_diagram_preview field widget uses."""
        self.ensure_one()
        self.write({'thumbnail': base64_png})

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        for rec in records:
            if rec.canvas_data:
                rec._sync_canvas_data()
        return records

    def write(self, vals):
        res = super().write(vals)
        if 'canvas_data' in vals:
            for rec in self:
                rec._sync_canvas_data()
        return res

    def _sync_canvas_data(self):
        import json
        try:
            data = json.loads(self.canvas_data or '{}')
        except Exception:
            return

        nodes_data = data.get('nodes', [])
        edges_data = data.get('edges', [])

        # 1. Sync Nodes. New nodes are batched into one create_multi() call
        # instead of one create() per node - on a diagram with many nodes
        # (e.g. right after a paste) this was previously one DB round-trip
        # per node on every single save.
        existing_nodes = {n.node_uuid: n for n in self.node_ids}
        current_node_uuids = []
        node_create_vals = []
        for n_data in nodes_data:
            uuid = n_data.get('id')
            if not uuid: continue
            current_node_uuids.append(uuid)
            vals = {
                'name': n_data.get('label', 'Unnamed Node'),
                'node_type': n_data.get('type', 'process'),
            }
            if uuid in existing_nodes:
                existing_nodes[uuid].write(vals)
            else:
                vals.update({'node_uuid': uuid, 'diagram_id': self.id})
                node_create_vals.append(vals)
        if node_create_vals:
            self.env['workflow.node'].create(node_create_vals)

        # Unlink removed nodes
        nodes_to_unlink = self.node_ids.filtered(lambda n: n.node_uuid not in current_node_uuids)
        if nodes_to_unlink:
            nodes_to_unlink.unlink()

        # 2. Sync Edges (same batching as nodes above)
        # Refresh nodes to get accurate mapping for source/target
        existing_nodes = {n.node_uuid: n for n in self.node_ids}
        existing_edges = {e.edge_uuid: e for e in self.edge_ids}
        current_edge_uuids = []
        edge_create_vals = []
        for e_data in edges_data:
            uuid = e_data.get('id')
            if not uuid: continue
            current_edge_uuids.append(uuid)

            source_node = existing_nodes.get(e_data.get('source'))
            target_node = existing_nodes.get(e_data.get('target'))

            vals = {
                'name': e_data.get('label', ''),
                'source_node_id': source_node.id if source_node else False,
                'target_node_id': target_node.id if target_node else False,
            }

            if uuid in existing_edges:
                existing_edges[uuid].write(vals)
            else:
                vals.update({'edge_uuid': uuid, 'diagram_id': self.id})
                edge_create_vals.append(vals)
        if edge_create_vals:
            self.env['workflow.edge'].create(edge_create_vals)

        # Unlink removed edges
        edges_to_unlink = self.edge_ids.filtered(lambda e: e.edge_uuid not in current_edge_uuids)
        if edges_to_unlink:
            edges_to_unlink.unlink()
