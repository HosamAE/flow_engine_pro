from odoo import models, fields

class WorkflowEdge(models.Model):
    _name = 'workflow.edge'
    _description = 'Workflow Edge (Search Index)'
    
    name = fields.Char(string='Label')
    edge_uuid = fields.Char(string='Canvas UUID', required=True, index=True)
    
    diagram_id = fields.Many2one('workflow.diagram', string='Diagram', required=True, ondelete='cascade')
    
    source_node_id = fields.Many2one('workflow.node', string='Source Node', ondelete='cascade')
    target_node_id = fields.Many2one('workflow.node', string='Target Node', ondelete='cascade')
