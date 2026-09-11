/** @odoo-module **/

import { Component, onMounted, onPatched, useRef } from '@odoo/owl';
import { registry } from '@web/core/registry';
import { MathUtils } from '@flow_engine_pro/core/math_utils';

// A tiny "what you'll actually get" swatch for the Flow Engine Pro
// Settings page - the user explicitly asked for the workspace's shapes to
// be shown somewhere while picking settings, rather than having to open
// a diagram just to see what a colour/border/font combination looks like.
// Draws two small canvases (one Flow shape, one Comment shape) using the
// exact same MathUtils drawing primitives the real canvas uses, reading
// the sibling fields' live (unsaved) values straight off the record - so
// it updates the instant you change a dropdown or colour picker, before
// you even save the settings page.
export class FlowAppearancePreview extends Component {
  static template = 'flow_engine_pro.FlowAppearancePreview';
  // Odoo's generic field-widget wrapper (<Field>) always passes this
  // standard set (id, name, readonly, record, ...) to whatever component
  // a widget="..." resolves to, whether or not that widget cares about
  // all of them - Owl's strict prop validation otherwise rejects the
  // extras outright and the settings page never renders. This widget
  // only actually reads `record`.
  static props = {
    id: { type: String, optional: true },
    name: { type: String, optional: true },
    readonly: { type: Boolean, optional: true },
    record: { type: Object, optional: true },
  };

  setup() {
    this.flowCanvasRef = useRef('flowPreview');
    this.commentCanvasRef = useRef('commentPreview');
    onMounted(() => this.draw());
    onPatched(() => this.draw());
  }

  // Reads a sibling field's current (possibly unsaved) value off the
  // settings record - falls back gracefully if the field isn't loaded
  // yet (e.g. an older diagram override page missing some of these).
  val(name, fallback) {
    const data = this.props.record && this.props.record.data;
    if (!data || !(name in data)) return fallback;
    const v = data[name];
    return v === false || v === '' || v === undefined || v === null ? fallback : v;
  }

  _borderFor(prefix) {
    return {
      width: this.val(`${prefix}_border_width`, 1),
      dash: this._dashFor(this.val(`${prefix === 'flow' ? 'flow' : 'comment'}_border_style`, prefix === 'flow' ? 'solid' : 'dashed')),
      enabled: this.val(`${prefix}_border_enabled`, true),
    };
  }

  _dashFor(style) {
    if (style === 'dotted') return [2, 3];
    if (style === 'solid') return [];
    return [6, 4];
  }

  draw() {
    this._drawFlow();
    this._drawComment();
  }

  _drawFlow() {
    const canvas = this.flowCanvasRef.el;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const shape = this.val('flow_default_shape', 'process');
    const stroke = this.val('flow_border_color', undefined);
    const border = this._borderFor('flow');
    const x = 14, y = 14, w = canvas.width - 28, h = canvas.height - 28;
    const color = '#bae1ff';
    if (shape === 'start_end') MathUtils.drawOval(ctx, x, y, w, h, false, color, stroke, border);
    else if (shape === 'decision') MathUtils.drawDiamond(ctx, x, y, w, h, false, '#ffdfba', stroke, border);
    else if (shape === 'data') MathUtils.drawParallelogram(ctx, x, y, w, h, false, '#d5c6f0', stroke, border);
    else MathUtils.drawRect(ctx, x, y, w, h, false, color, stroke, border);

    const fontSize = this.val('flow_default_font_size', 14);
    const fontFamily = this.val('flow_font_family', 'sans-serif');
    ctx.fillStyle = '#1e293b';
    ctx.font = `${Math.min(fontSize, 16)}px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Flow', canvas.width / 2, canvas.height / 2);
  }

  _drawComment() {
    const canvas = this.commentCanvasRef.el;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const shape = this.val('flow_default_comment_shape', 'comment');
    const stroke = this.val('comment_border_color', undefined);
    const border = this._borderFor('comment');
    const x = 14, y = 14, w = canvas.width - 28, h = canvas.height - 28;
    const color = '#fff9c4';
    const drawers = {
      comment: () => MathUtils.drawSpeechBubble(ctx, x, y, w, h, false, color, stroke, border),
      rect: () => MathUtils.drawRect(ctx, x, y, w, h, false, '#e2e8f0', stroke, border),
      triangle: () => MathUtils.drawTriangle(ctx, x, y, w, h, false, '#e2e8f0', stroke, border),
      pentagon: () => MathUtils.drawPentagon(ctx, x, y, w, h, false, '#e2e8f0', stroke, border),
      hexagon: () => MathUtils.drawHexagon(ctx, x, y, w, h, false, '#e2e8f0', stroke, border),
      star: () => MathUtils.drawStar(ctx, x, y, w, h, false, '#e2e8f0', stroke, border),
      trapezoid: () => MathUtils.drawTrapezoid(ctx, x, y, w, h, false, '#e2e8f0', stroke, border),
    };
    (drawers[shape] || drawers.comment)();

    const fontSize = this.val('comment_font_size', 14);
    const fontFamily = this.val('comment_font_family', 'sans-serif');
    const textColor = this.val('comment_font_color', '#1e293b');
    ctx.fillStyle = textColor;
    ctx.font = `${Math.min(fontSize, 16)}px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Note', canvas.width / 2, canvas.height / 2 - 4);
  }
}

registry.category('fields').add('flow_appearance_preview', { component: FlowAppearancePreview });
