/** @odoo-module **/

import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { Many2OneField, many2OneField } from "@web/views/fields/many2one/many2one_field";

// A generic widget for a Many2one field to workflow.diagram, addable to
// ANY model (e.g. `flow_id = fields.Many2one('workflow.diagram')` +
// `<field name="flow_id" widget="flow_diagram_preview"/>` in that
// model's own view). Wraps the standard Many2One picker (still fully
// searchable/editable) and, once a diagram is set, shows its live
// thumbnail (see workflow.diagram.save_snapshot()) above it - clicking
// the thumbnail opens the Flow IDE on that diagram.
//
// Odoo 17 port note: unlike Odoo 19, there's no standalone low-level
// Many2One component to compose around (no computeM2OProps either) -
// Many2OneField itself is the whole picker. So this extends
// Many2OneField directly and reuses its own template via t-call, instead
// of wrapping a separate Many2One component the way the 19.0 branch does.
export class FlowDiagramPreviewField extends Many2OneField {
  static template = "flow_engine_pro.FlowDiagramPreviewField";

  setup() {
    super.setup();
    this.action = useService("action");
  }

  get diagram() {
    return this.props.record.data[this.props.name];
  }

  get thumbnailUrl() {
    if (!this.diagram) return null;
    // Cache-bust on every render so a just-refreshed snapshot doesn't
    // keep showing a stale browser-cached image at the same URL.
    return `/web/image/workflow.diagram/${this.diagram.id}/thumbnail?unique=${Date.now()}`;
  }

  openDiagram() {
    if (!this.diagram) return;
    this.action.doAction("flow_engine_pro.action_open_flow_ide", {
      additionalContext: { active_id: this.diagram.id },
    });
  }
}

export const flowDiagramPreviewField = {
  ...many2OneField,
  component: FlowDiagramPreviewField,
};

registry.category("fields").add("flow_diagram_preview", flowDiagramPreviewField);
