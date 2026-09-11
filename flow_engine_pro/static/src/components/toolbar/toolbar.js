/** @odoo-module **/

import { Component } from "@odoo/owl";

export class FlowToolbar extends Component {
    static template = "flow_engine_pro.FlowToolbar";
    static props = {
        mode: String,
        setMode: Function,
    };

    get isEditMode() {
        return this.props.mode !== 'pan';
    }

    toggleMode() {
        if (this.props.mode === 'pan') {
            this.props.setMode('select');
        } else {
            this.props.setMode('pan');
        }
    }

    toggleTool(toolName) {
        // If the tool is already active, clicking it again deactivates it back to 'select' (Arrow)
        if (this.props.mode === toolName) {
            this.props.setMode('select');
        } else {
            this.props.setMode(toolName);
        }
    }
}
