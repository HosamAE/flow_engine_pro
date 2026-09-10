import json

from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install')
class TestWorkflowDiagramSync(TransactionCase):
    """The JSON canvas_data blob is the source of truth; workflow.node/
    workflow.edge are a SQL search-index shadow of it, kept in sync on
    every create()/write() (see workflow_diagram.py's _sync_canvas_data).
    These tests exist because that sync was previously verified only by
    hand, once, during development - a regression here would silently
    break global search without any visible symptom in the canvas itself
    (review 2026-09-09/10: "no automated test suite" was flagged as a
    real risk).
    """

    def _canvas_data(self, *nodes_edges):
        nodes, edges = nodes_edges
        return json.dumps({'nodes': nodes, 'edges': edges})

    def test_sync_on_create(self):
        diagram = self.env['workflow.diagram'].create({
            'name': 'Sync Test Diagram',
            'canvas_data': self._canvas_data(
                [
                    {'id': 'n1', 'x': 0, 'y': 0, 'width': 120, 'height': 50, 'type': 'start_end', 'label': 'Start'},
                    {'id': 'n2', 'x': 0, 'y': 150, 'width': 120, 'height': 50, 'type': 'process', 'label': 'Do Work'},
                ],
                [
                    {'id': 'e1', 'source': 'n1', 'target': 'n2'},
                ],
            ),
        })
        self.assertEqual(len(diagram.node_ids), 2)
        self.assertEqual(len(diagram.edge_ids), 1)
        self.assertEqual(set(diagram.node_ids.mapped('node_uuid')), {'n1', 'n2'})
        start_node = diagram.node_ids.filtered(lambda n: n.node_uuid == 'n1')
        self.assertEqual(start_node.name, 'Start')
        self.assertEqual(start_node.node_type, 'start_end')

    def test_sync_on_update_create_modify_unlink(self):
        diagram = self.env['workflow.diagram'].create({
            'name': 'Sync Update Test',
            'canvas_data': self._canvas_data(
                [
                    {'id': 'n1', 'x': 0, 'y': 0, 'width': 120, 'height': 50, 'type': 'start_end', 'label': 'Start'},
                    {'id': 'n2', 'x': 0, 'y': 150, 'width': 120, 'height': 50, 'type': 'process', 'label': 'Old Label'},
                ],
                [{'id': 'e1', 'source': 'n1', 'target': 'n2'}],
            ),
        })
        # n1 removed, n2 relabeled, n3 added, edge replaced accordingly.
        diagram.write({
            'canvas_data': self._canvas_data(
                [
                    {'id': 'n2', 'x': 0, 'y': 150, 'width': 120, 'height': 50, 'type': 'process', 'label': 'New Label'},
                    {'id': 'n3', 'x': 0, 'y': 300, 'width': 120, 'height': 50, 'type': 'start_end', 'label': 'End'},
                ],
                [{'id': 'e2', 'source': 'n2', 'target': 'n3'}],
            ),
        })
        self.assertEqual(len(diagram.node_ids), 2, "n1 should have been unlinked, n3 created")
        self.assertEqual(set(diagram.node_ids.mapped('node_uuid')), {'n2', 'n3'})
        n2 = diagram.node_ids.filtered(lambda n: n.node_uuid == 'n2')
        self.assertEqual(n2.name, 'New Label', "existing node should be updated in place, not recreated")
        self.assertEqual(len(diagram.edge_ids), 1)
        self.assertEqual(diagram.edge_ids.edge_uuid, 'e2')

    def test_searchable_globally_by_node_name(self):
        # This is exactly what the Search & Pulse feature relies on -
        # finding a shape by name without knowing which diagram it's in.
        self.env['workflow.diagram'].create({
            'name': 'Findable Diagram',
            'canvas_data': self._canvas_data(
                [{'id': 'n1', 'x': 0, 'y': 0, 'width': 120, 'height': 50, 'type': 'process', 'label': 'Very Unique Label 42'}],
                [],
            ),
        })
        found = self.env['workflow.node'].search([('name', 'ilike', 'Very Unique Label 42')])
        self.assertEqual(len(found), 1)


@tagged('post_install', '-at_install')
class TestWorkflowDiagramSettings(TransactionCase):

    def test_effective_settings_defaults_when_no_override(self):
        diagram = self.env['workflow.diagram'].create({'name': 'Defaults Test'})
        settings = diagram.get_effective_settings()
        self.assertEqual(settings['default_flow_shape'], 'process')
        self.assertEqual(settings['line_width'], 2.5)
        # Deliberately blank, not a hardcoded hex, so the canvas can derive
        # it from the current Odoo theme instead (see the model's own
        # comment on this field).
        self.assertEqual(settings['line_color'], '')

    def test_effective_settings_respects_per_diagram_override(self):
        diagram = self.env['workflow.diagram'].create({
            'name': 'Override Test',
            'override_flow_shape': 'decision',
            'override_line_width': 5.0,
        })
        settings = diagram.get_effective_settings()
        self.assertEqual(settings['default_flow_shape'], 'decision')
        self.assertEqual(settings['line_width'], 5.0)


@tagged('post_install', '-at_install')
class TestWorkflowDiagramSecurity(TransactionCase):
    """Flow Engine Pro's own security groups (added 2026-09-09): User can
    create/edit but not delete; Manager can do both."""

    def setUp(self):
        super().setUp()
        self.diagram = self.env['workflow.diagram'].create({'name': 'Security Test Diagram'})

    def _make_user(self, login, group_xmlid):
        return self.env['res.users'].create({
            'name': login,
            'login': login,
            'group_ids': [(6, 0, [self.env.ref(group_xmlid).id])],
        })

    def test_flow_user_cannot_delete(self):
        user = self._make_user('flow_user_test', 'flow_engine_pro.group_flow_user')
        diagram_as_user = self.diagram.with_user(user)
        # Read/write should work fine.
        diagram_as_user.write({'name': 'Renamed by User'})
        with self.assertRaises(AccessError):
            diagram_as_user.unlink()

    def test_flow_manager_can_delete(self):
        user = self._make_user('flow_manager_test', 'flow_engine_pro.group_flow_manager')
        diagram_id = self.diagram.id
        self.diagram.with_user(user).unlink()
        self.assertFalse(self.env['workflow.diagram'].search([('id', '=', diagram_id)]))

    def test_user_without_any_group_has_no_access(self):
        user = self.env['res.users'].create({'name': 'no_flow_access', 'login': 'no_flow_access'})
        with self.assertRaises(AccessError):
            self.diagram.with_user(user).read(['name'])
