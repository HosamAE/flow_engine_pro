/** @odoo-module **/

import { Component } from '@odoo/owl';
import { Dialog } from '@web/core/dialog/dialog';

// General "how do I use this" + "what is this" info, reached from the small
// (i) button in the sidebar header - deliberately app-wide, not tied to any
// one diagram (per-diagram info lives in the Settings panel instead).
export class FlowHelpDialog extends Component {
  static template = 'flow_engine_pro.FlowHelpDialog';
  static components = { Dialog };
  static props = { close: Function };
}
