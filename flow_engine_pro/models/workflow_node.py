from odoo import models, fields

class WorkflowNode(models.Model):
    _name = 'workflow.node'
    _description = 'Workflow Node (Search Index)'
    _order = 'name'

    name = fields.Char(string='Node Name', required=True, index=True)
    node_uuid = fields.Char(string='Canvas UUID', required=True, index=True,
        help="The unique ID from the Flow Engine JSON to map clicks to the canvas.")
    
    diagram_id = fields.Many2one('workflow.diagram', string='Diagram', required=True, ondelete='cascade')
    
    node_type = fields.Selection([
        ('start_end', 'Oval (Start/End)'),
        ('process', 'Rectangle (Process)'),
        ('decision', 'Diamond (Decision)'),
        ('data', 'Parallelogram (I/O Data)'),
        ('comment', 'Speech Bubble (Comment)'),
        # Comment-category shape library (see canvas.js's long-press
        # shape picker and math_utils.js's drawTriangle/etc.) - without
        # these, saving any diagram containing one of these shapes threw
        # a hard ValueError from this Selection field and failed the
        # whole write(), not just the sync of this one node.
        ('triangle', 'Triangle (Comment)'),
        ('pentagon', 'Pentagon (Comment)'),
        ('hexagon', 'Hexagon (Comment)'),
        ('star', 'Star (Comment)'),
        ('trapezoid', 'Trapezoid (Comment)'),
    ], string='Shape Type', default='process')
