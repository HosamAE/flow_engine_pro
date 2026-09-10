/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { computeM2OProps, Many2One } from "@web/views/fields/many2one/many2one";
import { buildM2OFieldDescription, Many2OneField } from "@web/views/fields/many2one/many2one_field";

// A generic widget for a Many2one field to workflow.diagram, addable to
// ANY model (e.g. `flow_id = fields.Many2one('workflow.diagram')` +
// `<field name="flow_id" widget="flow_diagram_preview"/>` in that
// model's own view). Wraps the standard Many2One picker (still fully
// searchable/editable) and, once a diagram is set, shows its live
// thumbnail (see workflow.diagram.save_snapshot()) above it - clicking
// the thumbnail opens the Flow IDE on that diagram.
export class FlowDiagramPreviewField extends Component {
  static template = "flow_engine_pro.FlowDiagramPreviewField";
  static components = { Many2One };
  static props = { ...Many2OneField.props };

  setup() {
    this.action = useService("action");
  }

  get m2oProps() {
    return computeM2OProps(this.props);
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
  ...buildM2OFieldDescription(FlowDiagramPreviewField),
};

registry.category("fields").add("flow_diagram_preview", flowDiagramPreviewField);
