/** @odoo-module **/

import { Component, useRef, useState, onMounted, onWillUnmount } from '@odoo/owl';
import { useService } from '@web/core/utils/hooks';
import { MathUtils } from '@flow_engine_pro/core/math_utils';
import * as CanvasRouting from '@flow_engine_pro/components/canvas/canvas_routing';
import { layoutFlowDiagram } from '@flow_engine_pro/components/canvas/canvas_layout';
import * as CanvasInteraction from '@flow_engine_pro/components/canvas/canvas_interaction';

export class FlowCanvas extends Component {
  static template = 'flow_engine_pro.FlowCanvas';
  // Was missing every prop but canvasData/mode - flow_ide.xml has always
  // passed all of these (see the <FlowCanvas .../> tag), so Owl's strict
  // prop validation rejected them and crashed the component on every
  // mount ("Invalid props ... unknown key 'setMode' ..."), i.e. as soon
  // as a diagram was opened. onAction is listed for completeness (used
  // internally at canvas.js:85) but is intentionally left unwired from
  // flow_ide.xml: FlowIDE already has its own window-level keydown
  // listener that handles Ctrl+Z/Y directly, so also wiring onAction
  // here would fire undo/redo twice per keypress.
  static props = {
    canvasData: Object,
    mode: String,
    setMode: Function,
    setActiveNodeId: Function,
    setActiveEdgeId: Function,
    magneticSnap: Boolean,
    onTransformChange: Function,
    onChange: Function,
    onAction: { type: Function, optional: true },
    registerApi: { type: Function, optional: true },
    settings: { type: Object, optional: true },
    onSaveSnapshot: { type: Function, optional: true },
  };

  // Fallbacks used until flow_ide.js's ORM call to
  // workflow.diagram.get_effective_settings() resolves (or if no
  // settings prop is passed at all) - keeps every value below optional.
  static defaultSettings = {
    default_flow_shape: 'process',
    default_comment_shape: 'comment',
    default_shape_width: 120,
    default_shape_height: 50,
    longpress_duration_ms: 550,
    default_font_size: 14,
    flow_font_family: 'sans-serif',
    comment_font_size: 14,
    comment_font_family: 'sans-serif',
    // Left blank on purpose - resolved against the page's own light/dark
    // theme CSS variables in the getter below instead of a hardcoded hex,
    // so the canvas isn't stuck light-mode-only once dark mode is on. See
    // workflow.diagram.get_effective_settings() for the same reasoning on
    // the backend default.
    comment_font_color: '',
    line_color: '',
    line_width: 2.5,
    arrow_style: 'triangle',
    flow_border_enabled: true,
    flow_border_style: 'solid',
    flow_border_color: '', // '' = each shape keeps its own per-type stroke colour
    flow_border_width: 1,
    comment_border_enabled: true,
    comment_border_style: 'dashed',
    comment_border_color: '',
    comment_border_width: 1,
    canvas_bg_style: 'dots',
    canvas_bg_color: '',
    capture_local_download: true,
  };

  get settings() {
    const merged = { ...FlowCanvas.defaultSettings, ...(this.props.settings || {}) };
    if (!merged.line_color) merged.line_color = this._themeColor('--fe-text-primary', '#1e293b');
    if (!merged.canvas_bg_color) merged.canvas_bg_color = this._themeColor('--fe-bg-canvas', '#f8fafc');
    // NOT theme-following, unlike line_color/canvas_bg_color above - those
    // track the canvas's OWN background, which does follow the theme, but
    // a comment shape's fill is always one of the fixed light pastel swatch
    // colours regardless of dark mode. Defaulting this to the dark-mode
    // theme's (light-coloured) text made every comment render in
    // near-white text on its own light fill - illegible (found live on
    // highnox_v19, chat history 2026-09-08). A plain reliable dark default
    // is safe here; only an admin's own explicit Settings choice overrides
    // it.
    if (!merged.comment_font_color) merged.comment_font_color = '#1e293b';
    return merged;
  }

  // { width, dash, enabled } for a node's own outline, per Settings > Flow
  // Engine Pro (or this diagram's override) - shared by _drawNode() and
  // the shape-picker's own preview icons.
  _borderOptionsFor(node) {
    const isComment = node.isCommentCategory || node.type === 'comment';
    const prefix = isComment ? 'comment' : 'flow';
    const s = this.settings;
    const style = s[`${prefix}_border_style`];
    const dash = style === 'dotted' ? [2, 3] : style === 'solid' ? [] : [6, 4];
    return { width: s[`${prefix}_border_width`], dash, enabled: s[`${prefix}_border_enabled`] };
  }

  // Border stroke colour override, or undefined so each shape's draw
  // function falls back to its own per-type default colour (see
  // math_utils.js) - undefined, not '', because JS default parameters
  // only kick in for undefined.
  _borderColorFor(node) {
    const isComment = node.isCommentCategory || node.type === 'comment';
    return this.settings[`${isComment ? 'comment' : 'flow'}_border_color`] || undefined;
  }

  // Canvas 2D drawing can't reference CSS variables directly (ctx.fillStyle
  // only accepts a resolved colour) - this reads one from the DOM once and
  // caches it, so the canvas's own light/dark palette (background, grid,
  // default line colour) stays in sync with Odoo's theme instead of being
  // hardcoded to light mode. Cached per variable name since the theme
  // itself can't change without a full page reload (color_scheme is
  // resolved server-side - see highnox_backend_theme's ir.http override).
  _themeColor(varName, fallback) {
    if (!this._themeColorCache) this._themeColorCache = {};
    if (this._themeColorCache[varName]) return this._themeColorCache[varName];
    const el = this.canvasRef && this.canvasRef.el;
    const value = el ? getComputedStyle(el).getPropertyValue(varName).trim() : '';
    const resolved = value || fallback;
    this._themeColorCache[varName] = resolved;
    return resolved;
  }

  setup() {
    this.canvasRef = useRef('canvas');
    this.inlineEditor = useRef('inlineEditor');
    this.notification = useService('notification');
    this.camera = { x: 0, y: 0, zoom: 1 };
    this._highlightNodeIds = new Set();
    this._stickyHighlightNodeIds = new Set();
    this.state = useState({
      isDraggingCanvas: false,
      isDraggingNode: false,
      isMarquee: false,
      activeNode: null,
      marqueeStart: { x: 0, y: 0 },
      mousePos: { x: 0, y: 0 },
      lastMouse: { x: 0, y: 0 },
      selectedNodes: new Set(),
      selectedEdge: null,
      isDrawingEdge: false,
      edgeStartNode: null,
      edgeStartPos: null,
      isDraggingEdgeHandle: false,
      draggingEdge: null,
      draggingEndpoint: null,
      // Resize
      isResizingNode: false,
      resizeNode: null,
      resizeHandle: null, // 'nw','n','ne','e','se','s','sw','w'
      resizeStart: null, // { mx, my, x, y, w, h }
      // Middle-click / Space pan
      isMiddlePan: false,
      isSpacePan: false,
      spaceDown: false,
      // Hover & Floating UI
      hoveredNodeId: null,
      hoveredEdgeId: null,
      showFloatingToolbar: false,
      floatingToolbarPos: { x: 0, y: 0 },
      // Inline Editing
      isEditingText: false,
      editorValue: '',
      editorStyle: '',
      editingTarget: null,
      // Long-press shape picker
      shapePickerNode: null,
      shapePickerPos: { x: 0, y: 0 },
      // Smart alignment guides shown while dragging a single shape
      alignmentGuides: [],
      // Comment shape being sized by click-drag (see onMouseDown's
      // draw_comment_shape branch)
      isDrawingCommentShape: false,
      commentDrawNode: null,
      commentDrawStart: { x: 0, y: 0 },
    });
    this._longPressTimer = null;
    this._longPressStartPos = null;

    // Ensure data arrays exist
    if (!this.props.canvasData.nodes) this.props.canvasData.nodes = [];
    if (!this.props.canvasData.edges) this.props.canvasData.edges = [];

    this.flowActionHandler = this.onFlowAction.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);

    onMounted(() => {
      window.addEventListener('flow_action', this.flowActionHandler);
      document.addEventListener('keydown', this._onKeyDown);
      document.addEventListener('keyup', this._onKeyUp);
      this.initCanvas();
      this.renderLoop();
      this.canvasRef.el.addEventListener('wheel', this._onWheel, { passive: false });
      // Hands the Navigator minimap (flow_ide.js) a way to move this
      // camera without a direct component reference - Owl component refs
      // only expose the DOM node, not the instance.
      if (this.props.registerApi) {
        this.props.registerApi({
          centerOn: (wx, wy) => this.centerOn(wx, wy),
          captureSnapshotDataUrl: () => this.canvasRef.el.toDataURL('image/png'),
          fitToContent: () => this._fitToContent(),
          pulseNode: (nodeUuid) => this.pulseNode(nodeUuid),
          setHighlightedNodes: (nodeIds) => this.setHighlightedNodes(nodeIds),
          toggleStickyHighlight: (nodeId) => this.toggleStickyHighlight(nodeId),
          isNodeStickyHighlighted: (nodeId) => this.isNodeStickyHighlighted(nodeId),
        });
      }
      // The "default" camera state should mean "the whole diagram is in
      // view", not literally world-origin-at-100% - a diagram drawn away
      // from (0,0) would otherwise open partially or fully off-screen
      // (user request 2026-09-09: opening any diagram should land exactly
      // where pressing the Navigator's crosshair/reset-view button would).
      // Deferred to the next frame - calling this synchronously during
      // onMounted measured the canvas element mid-layout and landed a
      // whole percentage point off from the exact same call made later
      // (e.g. from the crosshair button), once everything had actually
      // settled. A single rAF-deferred call is the one true "default"
      // measurement, matching what a later user-triggered reset sees.
      requestAnimationFrame(() => this._fitToContent());
    });

    onWillUnmount(() => {
      window.removeEventListener('flow_action', this.flowActionHandler);
      document.removeEventListener('keydown', this._onKeyDown);
      document.removeEventListener('keyup', this._onKeyUp);
      if (this.canvasRef.el) {
        this.canvasRef.el.removeEventListener('wheel', this._onWheel);
      }
    });
  }

  onFlowAction(ev) {
    const action = ev.detail.action;
    if (action === 'undo' || action === 'redo') {
      if (this.props.onAction) this.props.onAction(action);
      return;
    }
    if (action === 'delete') {
      if (this.props.mode === 'pan') return;
      if (this.state.selectedNodes.size > 0) {
        // Delete nodes/points
        this.props.canvasData.nodes = this.props.canvasData.nodes.filter((n) => !this.state.selectedNodes.has(n.id));
        // Delete edges connected to deleted nodes
        this.props.canvasData.edges = this.props.canvasData.edges.filter((e) => !this.state.selectedNodes.has(e.sourceNode) && !this.state.selectedNodes.has(e.targetNode));
        this.state.selectedNodes.clear();
        if (this.props.setActiveNodeId) this.props.setActiveNodeId(null);
        if (this.props.onChange) this.props.onChange();
      }
    } else if (action === 'copy') {
      const nodesToCopy = this.props.canvasData.nodes.filter((n) => this.state.selectedNodes.has(n.id));
      localStorage.setItem('flow_clipboard', JSON.stringify(nodesToCopy));
    } else if (action === 'cut') {
      const nodesToCopy = this.props.canvasData.nodes.filter((n) => this.state.selectedNodes.has(n.id));
      localStorage.setItem('flow_clipboard', JSON.stringify(nodesToCopy));
      this.onFlowAction({ detail: { action: 'delete' } });
    } else if (action === 'paste') {
      try {
        const clipboardData = localStorage.getItem('flow_clipboard');
        if (!clipboardData) return;
        const clipboard = JSON.parse(clipboardData);
        if (clipboard && clipboard.length > 0) {
          const idMap = {};
          this.state.selectedNodes.clear();
          for (const node of clipboard) {
            const newId = MathUtils.uuidv4();
            idMap[node.id] = newId;
            const newNode = { ...node, id: newId, x: node.x + 40, y: node.y + 40 };
            this.props.canvasData.nodes.push(newNode);
            this.state.selectedNodes.add(newId);
          }
          if (this.props.onChange) this.props.onChange();
        }
      } catch (e) {}
    } else if (action === 'snapshot') {
      // Was unreachable until now: 'snapshot' was grouped with
      // undo/redo's early-return above, which called the (intentionally
      // unwired, see FlowCanvas static props) onAction prop and
      // returned before ever reaching this branch - clicking Capture
      // silently did nothing.
      const dataURL = this.canvasRef.el.toDataURL('image/png');
      // Capture always saves into the diagram's internal storage (see
      // Settings > Flow Engine Pro's help text) - the local browser
      // download is the optional part, gated by Settings.
      if (this.props.onSaveSnapshot) this.props.onSaveSnapshot(dataURL);
      if (this.settings.capture_local_download) {
        const filename = `Snapshot_${new Date().getTime()}.png`;
        const a = document.createElement('a');
        a.href = dataURL;
        a.download = filename;
        a.click();
      }
      if (this.notification) {
        this.notification.add('Snapshot saved.', { type: 'success' });
      }
    } else if (action === 'auto_layout') {
      this._autoLayout(false);
    } else if (action === 'auto_layout_with_comments') {
      this._autoLayout(true);
    } else if (action === 'zoom_in') {
      // Small, steady steps (10%) - the old 20%/click felt like a big
      // jump per the user's report ("نقل كبير جدا").
      this._zoomCenter(1.1);
    } else if (action === 'zoom_out') {
      this._zoomCenter(1 / 1.1);
    } else if (action === 'reset_view') {
      this._fitToContent();
    }
  }

  // Search & Pulse (finishes the TECHNICAL_SPEC.md item that was never
  // actually built, per the 2026-09-10 review): centers the camera on a
  // found node and marks it for a 3-second yellow pulse ring, drawn each
  // frame by _drawPulseHighlight() below.
  pulseNode(nodeUuid) {
    const node = (this.props.canvasData.nodes || []).find((n) => n.id === nodeUuid);
    if (!node) return;
    const cx = node.x + (node.width || 120) / 2;
    const cy = node.y + (node.height || 50) / 2;
    this.centerOn(cx, cy);
    this._pulseNodeId = nodeUuid;
    this._pulseStartTime = performance.now();
  }

  _drawPulseHighlight() {
    if (!this._pulseNodeId) return;
    const elapsed = performance.now() - this._pulseStartTime;
    if (elapsed > 3000) {
      this._pulseNodeId = null;
      return;
    }
    const node = (this.props.canvasData.nodes || []).find((n) => n.id === this._pulseNodeId);
    if (!node) {
      this._pulseNodeId = null;
      return;
    }
    const w = node.width || 120;
    const h = node.height || 50;
    // Ring pulses (grows/fades) on an 800ms cycle, while the whole effect
    // fades out over the full 3s so it doesn't linger indefinitely.
    const cyclePhase = (elapsed % 800) / 800;
    const overallFade = 1 - elapsed / 3000;
    const ringPad = 8 + cyclePhase * 14;
    const opacity = (1 - cyclePhase) * 0.9 * overallFade;
    this.ctx.save();
    this.ctx.strokeStyle = `rgba(250, 204, 21, ${opacity})`;
    this.ctx.lineWidth = 4 / this.camera.zoom;
    this.ctx.beginPath();
    if (this.ctx.roundRect) {
      this.ctx.roundRect(node.x - ringPad, node.y - ringPad, w + ringPad * 2, h + ringPad * 2, 14);
    } else {
      this.ctx.rect(node.x - ringPad, node.y - ringPad, w + ringPad * 2, h + ringPad * 2);
    }
    this.ctx.stroke();
    this.ctx.restore();
  }

  // Static (non-fading) highlight rings, shared by three callers (user
  // request 2026-09-10): double-clicking a shape highlights just that one
  // while its Properties are open; the diagram-scoped header search
  // highlights every match as you type; a dedicated "pin" toggle in the
  // Properties panel keeps a highlight sticking around independently of
  // selection, in its own set so normal deselection never clears it.
  setHighlightedNodes(nodeIds) {
    this._highlightNodeIds = new Set(nodeIds || []);
  }

  toggleStickyHighlight(nodeId) {
    if (!this._stickyHighlightNodeIds) this._stickyHighlightNodeIds = new Set();
    if (this._stickyHighlightNodeIds.has(nodeId)) this._stickyHighlightNodeIds.delete(nodeId);
    else this._stickyHighlightNodeIds.add(nodeId);
  }

  isNodeStickyHighlighted(nodeId) {
    return !!(this._stickyHighlightNodeIds && this._stickyHighlightNodeIds.has(nodeId));
  }

  _drawStaticHighlights() {
    const transient = this._highlightNodeIds;
    const sticky = this._stickyHighlightNodeIds;
    if ((!transient || !transient.size) && (!sticky || !sticky.size)) return;
    const nodes = this.props.canvasData.nodes || [];
    const draw = (id, color) => {
      const node = nodes.find((n) => n.id === id);
      if (!node) return;
      const w = node.width || 120;
      const h = node.height || 50;
      const pad = 7;
      this.ctx.save();
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = 3 / this.camera.zoom;
      this.ctx.beginPath();
      if (this.ctx.roundRect) {
        this.ctx.roundRect(node.x - pad, node.y - pad, w + pad * 2, h + pad * 2, 10);
      } else {
        this.ctx.rect(node.x - pad, node.y - pad, w + pad * 2, h + pad * 2);
      }
      this.ctx.stroke();
      this.ctx.restore();
    };
    if (transient) for (const id of transient) draw(id, 'rgba(56, 189, 248, 0.9)');
    if (sticky) for (const id of sticky) draw(id, 'rgba(244, 114, 182, 0.9)');
  }

  // Frames the whole diagram in view - this IS the "default" camera
  // state now (mount, diagram switch, and the Reset button/Navigator
  // crosshair all funnel through here), replacing a flat (0,0,100%) that
  // could open partly or fully off-screen for a diagram not drawn near
  // the world origin (user request 2026-09-09).
  _fitToContent() {
    const el = this.canvasRef.el;
    if (!el) return;
    const nodes = (this.props.canvasData.nodes || []).filter((n) => !n.isPoint);
    if (!nodes.length) {
      this.camera.zoom = 1;
      this.camera.x = 0;
      this.camera.y = 0;
    } else {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of nodes) {
        const w = n.width || 100;
        const h = n.height || 50;
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + w);
        maxY = Math.max(maxY, n.y + h);
      }
      const PAD = 80;
      const contentW = Math.max(1, maxX - minX + PAD * 2);
      const contentH = Math.max(1, maxY - minY + PAD * 2);

      const dpr = el.width / el.getBoundingClientRect().width || 1;
      let obstructedRight = 0;
      const inspector = document.querySelector('.o_flow_right_inspector');
      if (inspector) obstructedRight += inspector.getBoundingClientRect().width * dpr;
      const usableWidth = el.width - obstructedRight;

      // Never zoom in past 100% just because a diagram is small - fitting
      // one lone shape to fill the whole screen would look wrong.
      const zoom = Math.min(usableWidth / contentW, el.height / contentH, 1);
      const centerWX = (minX + maxX) / 2;
      const centerWY = (minY + maxY) / 2;
      this.camera.zoom = Math.max(0.05, zoom);
      this.camera.x = usableWidth / 2 - centerWX * this.camera.zoom;
      this.camera.y = el.height / 2 - centerWY * this.camera.zoom;
    }
    if (this.props.onTransformChange) {
      this.props.onTransformChange({ x: this.camera.x, y: this.camera.y, zoom: this.camera.zoom });
    }
  }

  // Recenters the camera on a given world point, keeping current zoom -
  // used by the Navigator minimap so clicking/dragging on it jumps or
  // pans the main view to that spot.
  centerOn(wx, wy) {
    const el = this.canvasRef.el;
    if (!el) return;
    // The canvas element's own width never shrinks when the Properties
    // inspector opens - it's a position:fixed overlay drawn on top, not a
    // flex sibling - so centering on the raw el.width put "centered"
    // roughly a quarter-canvas-width into the area the inspector visually
    // covers. Subtract whichever fixed-position panels are actually open
    // right now so "centered" means the middle of what's really visible.
    const dpr = el.width / el.getBoundingClientRect().width || 1;
    let obstructedRight = 0;
    const inspector = document.querySelector('.o_flow_right_inspector');
    if (inspector) obstructedRight += inspector.getBoundingClientRect().width * dpr;
    const usableWidth = el.width - obstructedRight;
    this.camera.x = usableWidth / 2 - wx * this.camera.zoom;
    this.camera.y = el.height / 2 - wy * this.camera.zoom;
    if (this.props.onTransformChange) {
      this.props.onTransformChange({ x: this.camera.x, y: this.camera.y, zoom: this.camera.zoom });
    }
  }

  // ─── Zoom to cursor on mouse wheel ───────────────────────────────────────
  _onWheel(ev) {
    ev.preventDefault();
    if (!this.canvasRef || !this.canvasRef.el) return;

    const ctrl = ev.ctrlKey || ev.metaKey;
    const shift = ev.shiftKey;

    if (ctrl) {
      // ZOOM Logic (Existing)
      const MIN_ZOOM = 0.1;
      const MAX_ZOOM = 4;
      const FACTOR = 0.05;

      const rect = this.canvasRef.el.getBoundingClientRect();
      const scaleX = this.canvasRef.el.width / rect.width;
      const scaleY = this.canvasRef.el.height / rect.height;

      const mx = (ev.clientX - rect.left) * scaleX;
      const my = (ev.clientY - rect.top) * scaleY;

      const oldZoom = this.camera.zoom;
      let newZoom = ev.deltaY < 0 ? Math.min(MAX_ZOOM, oldZoom * (1 + FACTOR)) : Math.max(MIN_ZOOM, oldZoom * (1 - FACTOR));

      this.camera.x = mx - (mx - this.camera.x) * (newZoom / oldZoom);
      this.camera.y = my - (my - this.camera.y) * (newZoom / oldZoom);
      this.camera.zoom = newZoom;

      if (this.props.onTransformChange) {
        this.props.onTransformChange({ x: this.camera.x, y: this.camera.y, zoom: this.camera.zoom });
      }
    } else {
      // PAN / SCROLL Logic
      const speed = 0.8;
      // A trackpad's native two-finger horizontal swipe arrives as
      // ev.deltaX (no Shift needed) - it was previously ignored entirely,
      // so only vertical motion ever had any effect. Shift+wheel stays
      // supported too, for mice with a vertical-only wheel.
      if (ev.deltaX) {
        this.camera.x -= ev.deltaX * speed;
      }
      if (shift) {
        this.camera.x -= ev.deltaY * speed;
      } else {
        this.camera.y -= ev.deltaY * speed;
      }
      if (this.props.onTransformChange) {
        this.props.onTransformChange({ x: this.camera.x, y: this.camera.y, zoom: this.camera.zoom });
      }
    }
  }

  // ─── Keyboard shortcuts ───────────────────────────────────────────────────
  _onKeyDown(ev) {
    if (this.state.isEditingText) return;

    const ctrl = ev.ctrlKey || ev.metaKey;
    const key = ev.key.toLowerCase();

    // Undo / Redo
    if (ctrl) {
      if (key === 'z') {
        ev.preventDefault();
        if (ev.shiftKey) {
          this.onFlowAction({ detail: { action: 'redo' } });
        } else {
          this.onFlowAction({ detail: { action: 'undo' } });
        }
        return;
      }
      if (key === 'y') {
        ev.preventDefault();
        this.onFlowAction({ detail: { action: 'redo' } });
        return;
      }

      // Copy / Cut / Paste
      if (key === 'c') {
        ev.preventDefault();
        this.onFlowAction({ detail: { action: 'copy' } });
        return;
      }
      if (key === 'x') {
        ev.preventDefault();
        this.onFlowAction({ detail: { action: 'cut' } });
        return;
      }
      if (key === 'v') {
        ev.preventDefault();
        this.onFlowAction({ detail: { action: 'paste' } });
        return;
      }

      // Select All
      if (key === 'a' && this.props.mode !== 'pan') {
        ev.preventDefault();
        this.state.selectedNodes.clear();
        for (const node of this.props.canvasData.nodes) {
          this.state.selectedNodes.add(node.id);
        }
        if (this.props.onChange) this.props.onChange();
        return;
      }
    }

    // Delete selected
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      if (this.state.selectedNodes.size > 0 || this.state.selectedEdge) {
        ev.preventDefault();
        this.deleteSelected();
      }
    }

    // Zoom in / out
    if (ctrl && (ev.key === '=' || ev.key === '+')) {
      ev.preventDefault();
      this._zoomCenter(1.1);
      return;
    }
    if (ctrl && ev.key === '-') {
      ev.preventDefault();
      this._zoomCenter(1 / 1.1);
      return;
    }
    if (ctrl && ev.key === '0') {
      ev.preventDefault();
      this.camera.zoom = 1;
      this.camera.x = 0;
      this.camera.y = 0;
      return;
    }

    // Save / Discard Shortcuts
    if (ctrl && ev.key === 's') {
      ev.preventDefault();
      this.onFlowAction({ detail: { action: 'save' } });
      return;
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      if (this.state.isDrawingEdge || this.state.isMarquee || this.state.selectedNodes.size > 0) {
        this.state.isDrawingEdge = false;
        this.state.isMarquee = false;
        this.state.selectedNodes.clear();
        if (this.props.setMode) this.props.setMode('select');
      } else {
        this.onFlowAction({ detail: { action: 'discard' } });
      }
      return;
    }

    // Space → enable pan cursor
    if (ev.key === ' ' && !ev.repeat) {
      ev.preventDefault();
      this.state.spaceDown = true;
      if (this.canvasRef.el) this.canvasRef.el.style.cursor = 'grab';
      return;
    }

    // Arrow keys: pan canvas or move nodes
    const PAN_STEP = ev.shiftKey ? 80 : 20;
    const NODE_STEP = ev.shiftKey ? 20 : 5;
    const dxArr = ev.key === 'ArrowLeft' ? -1 : ev.key === 'ArrowRight' ? 1 : 0;
    const dyArr = ev.key === 'ArrowUp' ? -1 : ev.key === 'ArrowDown' ? 1 : 0;
    if (dxArr !== 0 || dyArr !== 0) {
      ev.preventDefault();
      if (this.state.selectedNodes.size > 0) {
        for (const nodeId of this.state.selectedNodes) {
          const node = this.props.canvasData.nodes.find((n) => n.id === nodeId);
          if (node) {
            node.x += dxArr * NODE_STEP;
            node.y += dyArr * NODE_STEP;
          }
        }
        if (this.props.onChange) this.props.onChange();
      } else {
        this.camera.x -= dxArr * PAN_STEP;
        this.camera.y -= dyArr * PAN_STEP;
      }
    }
  }

  _onKeyUp(ev) {
    if (ev.key === ' ') {
      this.state.spaceDown = false;
      this.state.isSpacePan = false;
      if (this.canvasRef.el) this.canvasRef.el.style.cursor = '';
    }
  }

  // Zoom centered on canvas center
  _zoomCenter(factor) {
    if (!this.canvasRef || !this.canvasRef.el) return;
    const cvs = this.canvasRef.el;
    const cx = cvs.width / 2;
    const cy = cvs.height / 2;
    const oldZoom = this.camera.zoom;
    const newZoom = Math.min(4, Math.max(0.1, oldZoom * factor));
    this.camera.x = cx - (cx - this.camera.x) * (newZoom / oldZoom);
    this.camera.y = cy - (cy - this.camera.y) * (newZoom / oldZoom);
    this.camera.zoom = newZoom;

    if (this.props.onTransformChange) {
      this.props.onTransformChange({ x: this.camera.x, y: this.camera.y, zoom: this.camera.zoom });
    }
  }

  initCanvas() {
    this.ctx = this.canvasRef.el.getContext('2d');
    const resizeObserver = new ResizeObserver(() => {
      if (this.canvasRef.el) {
        this.canvasRef.el.width = this.canvasRef.el.parentElement.clientWidth;
        this.canvasRef.el.height = this.canvasRef.el.parentElement.clientHeight;
      }
    });
    resizeObserver.observe(this.canvasRef.el.parentElement);
  }

  // Main 60fps render loop
  renderLoop() {
    if (!this.ctx || !this.canvasRef || !this.canvasRef.el) return;
    const cvs = this.canvasRef.el;
    if (cvs.width && cvs.height) {
      this.ctx.clearRect(0, 0, cvs.width, cvs.height);
      this.drawGrid();

      // Draw world (apply camera transforms natively using Context)
      this.ctx.save();
      this.ctx.translate(this.camera.x, this.camera.y);
      this.ctx.scale(this.camera.zoom, this.camera.zoom);

      this.drawEdges();
      this.drawNodes();
      this._drawPulseHighlight();
      this._drawStaticHighlights();

      if (this.state.isMarquee) this.drawMarquee();
      if (this.state.isDraggingNode && this.state.alignmentGuides.length) this.drawAlignmentGuides();

      this.ctx.restore();

      // Draw rulers in UI screen space
      this.drawRulers();
    }
    requestAnimationFrame(this.renderLoop.bind(this));
  }

  drawRulers() {
    const cvs = this.canvasRef.el;
    const ctx = this.ctx;
    const RULER_SIZE = 20;

    ctx.save();
    // Top Ruler
    ctx.fillStyle = this._themeColor('--fe-bg-surface', '#f8f9fa');
    ctx.fillRect(0, 0, cvs.width, RULER_SIZE);
    // Left Ruler
    ctx.fillRect(0, 0, RULER_SIZE, cvs.height);

    // Grid lines edge
    ctx.strokeStyle = this._themeColor('--fe-border', '#dee2e6');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, RULER_SIZE);
    ctx.lineTo(cvs.width, RULER_SIZE);
    ctx.moveTo(RULER_SIZE, 0);
    ctx.lineTo(RULER_SIZE, cvs.height);
    ctx.stroke();

    // Draw ticks
    ctx.fillStyle = this._themeColor('--fe-text-secondary', '#6c757d');
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const tickSpacing = 100 * this.camera.zoom;
    const startX = this.camera.x % tickSpacing;

    for (let x = startX; x < cvs.width; x += tickSpacing) {
      if (x < RULER_SIZE) continue;
      ctx.fillRect(x, RULER_SIZE - 5, 1, 5);
      let worldX = Math.round((x - this.camera.x) / this.camera.zoom);
      ctx.fillText(worldX.toString(), x, 2);
    }

    const startY = this.camera.y % tickSpacing;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let y = startY; y < cvs.height; y += tickSpacing) {
      if (y < RULER_SIZE) continue;
      ctx.fillRect(RULER_SIZE - 5, y, 5, 1);
      let worldY = Math.round((y - this.camera.y) / this.camera.zoom);

      ctx.save();
      ctx.translate(2, y);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(worldY.toString(), 0, 0);
      ctx.restore();
    }

    // Top left corner block
    ctx.fillStyle = this._themeColor('--fe-bg-input', '#e9ecef');
    ctx.fillRect(0, 0, RULER_SIZE, RULER_SIZE);
    ctx.restore();
  }

  // Returns a cached, loading-in-the-background <img> for a data URL -
  // ctx.drawImage() only works once the image has actually decoded, and
  // this is called every frame from the render loop, so we can't just
  // `new Image()` each time. The loop itself is a continuous 60fps
  // requestAnimationFrame chain, so no manual "redraw once loaded" hook
  // is needed - the very next frame just naturally sees img.complete.
  _getOrLoadImage(dataUrl) {
    if (!this._imageCache) this._imageCache = new Map();
    let img = this._imageCache.get(dataUrl);
    if (!img) {
      img = new Image();
      img.src = dataUrl;
      this._imageCache.set(dataUrl, img);
    }
    return img;
  }

  drawGrid() {
    const cvs = this.canvasRef.el;
    // Solid background fill from Settings, painted before the grid
    // pattern itself (a plain style is just this fill with nothing else).
    this.ctx.save();
    this.ctx.fillStyle = this.settings.canvas_bg_color;
    this.ctx.fillRect(0, 0, cvs.width, cvs.height);
    this.ctx.restore();

    const bgImageUrl = this.props.canvasData.backgroundImage;
    if (bgImageUrl) {
      const img = this._getOrLoadImage(bgImageUrl);
      if (img.complete && img.naturalWidth) {
        this.ctx.save();
        // Cover-fit: scale to fill the canvas without distortion, cropping
        // whichever axis overflows.
        const scale = Math.max(cvs.width / img.naturalWidth, cvs.height / img.naturalHeight);
        const w = img.naturalWidth * scale;
        const h = img.naturalHeight * scale;
        this.ctx.drawImage(img, (cvs.width - w) / 2, (cvs.height - h) / 2, w, h);
        this.ctx.restore();
      }
      // A background image already gives the canvas visual context - the
      // dot/grid pattern on top of a photo would just look like noise.
      return;
    }

    const style = this.settings.canvas_bg_style;
    if (style === 'plain') return;

    this.ctx.save();
    const gridSize = 20 * this.camera.zoom;
    const offsetX = this.camera.x % gridSize;
    const offsetY = this.camera.y % gridSize;

    if (style === 'grid') {
      this.ctx.strokeStyle = this._themeColor('--fe-border', '#e2e8f0');
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      for (let x = offsetX; x < cvs.width; x += gridSize) {
        this.ctx.moveTo(x, 0);
        this.ctx.lineTo(x, cvs.height);
      }
      for (let y = offsetY; y < cvs.height; y += gridSize) {
        this.ctx.moveTo(0, y);
        this.ctx.lineTo(cvs.width, y);
      }
      this.ctx.stroke();
    } else {
      // dots (default)
      this.ctx.fillStyle = this._themeColor('--fe-grid-dot', '#cccccc');
      for (let x = offsetX; x < cvs.width; x += gridSize) {
        for (let y = offsetY; y < cvs.height; y += gridSize) {
          this.ctx.beginPath();
          this.ctx.arc(x, y, 1, 0, Math.PI * 2);
          this.ctx.fill();
        }
      }
    }
    this.ctx.restore();
  }

  drawNodes() {
    // 1. Draw Tools first
    for (const node of this.props.canvasData.nodes) {
      if (!node.isPoint) this._drawNode(node);
    }
    // 2. Draw Points last (so they are on top)
    for (const node of this.props.canvasData.nodes) {
      if (!node.isPoint) continue;
      const isSelected = this.state.selectedNodes.has(node.id);
      const isConnected = this.props.canvasData.edges.some((e) => (e.sourceNode || e.source) === node.id || (e.targetNode || e.target) === node.id);

      // Hide point unless hovered, selected, or connected
      if (!isSelected && this.state.hoveredNodeId !== node.id && !isConnected) {
        continue;
      }

      this.ctx.beginPath();
      this.ctx.arc(node.x, node.y, 4, 0, Math.PI * 2);
      this.ctx.fillStyle = isSelected ? '#3b82f6' : 'rgba(251, 191, 36, 0.8)';
      this.ctx.fill();
      this.ctx.strokeStyle = '#fff';
      this.ctx.lineWidth = 1;
      this.ctx.stroke();
    }
  }
  _drawNode(node) {
    const isSelected = this.state.selectedNodes.has(node.id);
    const color = node.color || '#bae1ff';
    // Settings-driven outline (width/dash/enabled + optional colour
    // override) - each MathUtils.drawX() function applies it, and treats
    // an undefined colour as "use my own per-shape-type default" (see
    // math_utils.js's `stroke` parameter defaults).
    const border = this._borderOptionsFor(node);
    const stroke = this._borderColorFor(node);

    if (node.type === 'text') {
      // Pure text node
    } else if (node.type === 'oval' || node.type === 'start_end') {
      MathUtils.drawOval(this.ctx, node.x, node.y, node.width, node.height, isSelected, color, stroke, border);
    } else if (node.type === 'diamond' || node.type === 'decision') {
      MathUtils.drawDiamond(this.ctx, node.x, node.y, node.width, node.height, isSelected, color, stroke, border);
    } else if (node.type === 'process' || node.type === 'rect') {
      MathUtils.drawRect(this.ctx, node.x, node.y, node.width, node.height, isSelected, color, stroke, border);
    } else if (node.type === 'parallelogram' || node.type === 'data') {
      MathUtils.drawParallelogram(this.ctx, node.x, node.y, node.width, node.height, isSelected, color, stroke, border);
    } else if (node.type === 'comment') {
      MathUtils.drawSpeechBubble(this.ctx, node.x, node.y, node.width, node.height, isSelected, color, stroke, border);
    } else if (node.type === 'triangle') {
      MathUtils.drawTriangle(this.ctx, node.x, node.y, node.width, node.height, isSelected, color, stroke, border);
    } else if (node.type === 'pentagon') {
      MathUtils.drawPentagon(this.ctx, node.x, node.y, node.width, node.height, isSelected, color, stroke, border);
    } else if (node.type === 'hexagon') {
      MathUtils.drawHexagon(this.ctx, node.x, node.y, node.width, node.height, isSelected, color, stroke, border);
    } else if (node.type === 'star') {
      MathUtils.drawStar(this.ctx, node.x, node.y, node.width, node.height, isSelected, color, stroke, border);
    } else if (node.type === 'trapezoid') {
      MathUtils.drawTrapezoid(this.ctx, node.x, node.y, node.width, node.height, isSelected, color, stroke, border);
    } else {
      MathUtils.drawRect(this.ctx, node.x, node.y, node.width, node.height, isSelected, color, stroke, border);
    }

    // Comment background image (set from the Properties panel) - drawn
    // with 'source-atop' so it's confined to whatever silhouette the
    // shape just filled+stroked above, without needing to duplicate each
    // shape's own path logic here. Trade-off: the image also covers the
    // border stroke within that silhouette, so a comment with an image
    // reads as "the image IS the shape" rather than "image behind a
    // visible border" - acceptable since a photo background is normally
    // meant to be the whole visual.
    if (node.bgImage) {
      const img = this._getOrLoadImage(node.bgImage);
      if (img.complete && img.naturalWidth) {
        this.ctx.save();
        this.ctx.globalCompositeOperation = 'source-atop';
        this.ctx.drawImage(img, node.x, node.y, node.width, node.height);
        this.ctx.restore();
      }
    }

    this._drawNodeLabel(node);
    if (isSelected) this._drawSelectionHandles(node);
  }

  _drawSelectionHandles(node) {
    if (this.props.mode === 'pan') return;
    const z = this.camera.zoom;
    const HDL = 4.5 / z;
    const handles = this._getResizeHandles(node);
    this.ctx.fillStyle = '#fff';
    this.ctx.strokeStyle = '#3b82f6';
    this.ctx.lineWidth = 1.5 / z;
    for (const h of handles) {
      this.ctx.beginPath();
      this.ctx.rect(h.x - HDL, h.y - HDL, HDL * 2, HDL * 2);
      this.ctx.fill();
      this.ctx.stroke();
    }
  }

  _drawNodeLabel(node) {
    if (this.state.isEditingText && this.state.editingTarget === node) return;

    const isComment = node.isCommentCategory || node.type === 'comment' || node.type === 'text';

    // Prioritize user-selected textColor, then (for Comments) Settings'
    // configured Comment Text Color, else fall back to a luminance-based
    // contrast pick against the shape's own fill - this replaces an old
    // check that only flipped to white for one exact hex ('#1e293b'), so
    // any other custom-picked dark/black fill left dark-on-dark, invisible
    // text (user report 2026-09-09).
    let textColor = node.textColor || (isComment ? this.settings.comment_font_color : null);
    if (!textColor) {
      textColor = MathUtils.getContrastTextColor(node.color);
    }
    this.ctx.fillStyle = textColor;

    const weight = node.bold ? 'bold ' : '';
    const style = node.italic ? 'italic ' : '';
    const size = node.fontSize || (isComment ? this.settings.comment_font_size : this.settings.default_font_size) || '14';
    const family = isComment ? this.settings.comment_font_family : this.settings.flow_font_family;
    this.ctx.font = `${style}${weight}${size}px ${family}`;

    const align = node.align || 'center';
    this.ctx.textAlign = align;
    this.ctx.textBaseline = 'middle';

    const label = node.label || '';
    if (!label) return;

    // Word wrap logic
    const maxWidth = (node.width || 120) - 16; // 8px padding each side
    const lineHeight = parseInt(size) * 1.3;
    const words = label.split(' ');
    const lines = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? currentLine + ' ' + word : word;
      const metrics = this.ctx.measureText(testLine);
      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);

    // Vertical centering of multi-line text
    const totalHeight = lines.length * lineHeight;
    const centerY = node.y + (node.height || 50) / 2;
    const startY = centerY - totalHeight / 2 + lineHeight / 2;

    let x = node.x + (node.width || 0) / 2;
    if (align === 'left') x = node.x + 8;
    if (align === 'right') x = node.x + (node.width || 0) - 8;

    lines.forEach((line, i) => {
      this.ctx.fillText(line, x, startY + i * lineHeight);
    });
  }

  get activeFormat() {
    const nodeId = Array.from(this.state.selectedNodes)[0];
    const node = nodeId ? this.props.canvasData.nodes.find((n) => n.id === nodeId) : null;
    return {
      bold: node?.bold || false,
      italic: node?.italic || false,
      fontSize: node?.fontSize || '16',
      color: node?.color || '#333',
    };
  }

  getNode(id) {
    return this.props.canvasData.nodes.find((n) => n.id === id);
  }

  getEdge(id) {
    return this.props.canvasData.edges.find((e) => e.id === id);
  }

  toggleFormat(type) {
    this.state.selectedNodes.forEach((nodeId) => {
      const node = this.getNode(nodeId);
      if (node) {
        node[type] = !node[type];
      }
    });
    if (this.props.onChange) this.props.onChange();
  }

  setFontSize(size) {
    this.state.selectedNodes.forEach((nodeId) => {
      const node = this.getNode(nodeId);
      if (node) {
        node.fontSize = size;
      }
    });
    if (this.props.onChange) this.props.onChange();
  }

  setColor(color) {
    this.state.selectedNodes.forEach((nodeId) => {
      const node = this.getNode(nodeId);
      if (node) {
        node.color = color;
      }
    });
    if (this.props.onChange) this.props.onChange();
  }

  getNodePorts(node) {
    return CanvasRouting.getNodePorts(node);
  }

  _getResizeHandles(node) {
    return CanvasInteraction.getResizeHandles(node);
  }

  static _isFlowShapeNode(node) {
    return CanvasRouting.isFlowShapeNode(node);
  }

  // Edge routing/geometry logic (endpoint resolution, side assignment,
  // stub points, junction dots) lives in canvas_routing.js as of the
  // 2026-09-10 cleanup - these five delegate to it, unchanged behavior.
  _resolveEffectiveEndpoint(nodeId, cameFromEdgeId, visited = new Set()) {
    return CanvasRouting.resolveEffectiveEndpoint(this, nodeId, cameFromEdgeId, visited);
  }

  _isFlowLine(edge) {
    return CanvasRouting.isFlowLine(this, edge);
  }

  _computeEdgeSideInfo() {
    return CanvasRouting.computeEdgeSideInfo(this);
  }

  _getStubbedPointsFor(edge, n1, n2, edgeSideInfo) {
    return CanvasRouting.getStubbedPointsFor(this, edge, n1, n2, edgeSideInfo);
  }

  _getJunctionPoints(edgeSideInfo) {
    return CanvasRouting.getJunctionPoints(edgeSideInfo);
  }

  drawEdges() {
    const edgeSideInfo = this._computeEdgeSideInfo();

    for (const edge of this.props.canvasData.edges) {
      const n1 = this.getNode(edge.sourceNode || edge.source);
      const n2 = this.getNode(edge.targetNode || edge.target);
      if (!n1 || !n2) continue;

      // RULE: solid Flow line only if THIS edge's own ultimate ends
      // (after walking through any routing points) are both real Flow
      // shapes - not "is this edge part of a component that has 2+ Flow
      // shapes somewhere" (that older check wrongly drew a Comment
      // node's line solid whenever it hung off an otherwise-Flow node).
      const isSolid = this._isFlowLine(edge);
      const isEdgeSel = this.state.selectedEdge?.id === edge.id;

      this.ctx.save();
      if (isSolid) {
        // --- FORMAL LINE (Orthogonal) ---
        const points = this._getStubbedPointsFor(edge, n1, n2, edgeSideInfo);
        if (points) {
          MathUtils.drawPolylinePath(this.ctx, points, isEdgeSel, this.settings.line_color, this.settings.arrow_style, this.settings.line_width);
        } else {
          // One end is a routing point - no "side" concept applies,
          // fall back to the original direct boundary-to-boundary path.
          const reciprocal = this.props.canvasData.edges.filter(
            (e) =>
              ((e.sourceNode || e.source) === (edge.sourceNode || edge.source) && (e.targetNode || e.target) === (edge.targetNode || edge.target)) ||
              ((e.sourceNode || e.source) === (edge.targetNode || edge.target) && (e.targetNode || e.target) === (edge.sourceNode || edge.source)),
          );
          let offset = reciprocal.length > 1 ? (reciprocal.indexOf(edge) - (reciprocal.length - 1) / 2) * 25 : 0;
          this.ctx.strokeStyle = isEdgeSel ? '#0d6efd' : this.settings.line_color;
          this.ctx.lineWidth = isEdgeSel ? 3.5 : 2.5;
          this.ctx.setLineDash([]);
          MathUtils.drawOrthogonalPath(this.ctx, n1, n2, isEdgeSel, offset, this.settings.line_color, this.settings.arrow_style, this.settings.line_width);
        }

        if (edge.label) {
          const sC = MathUtils.getCenter(n1),
            eC = MathUtils.getCenter(n2);
          this._drawEdgeLabel(edge.label, (sC.x + eC.x) / 2, (sC.y + eC.y) / 2);
        }
      } else {
        // --- COMMENTARY LINE (Dashed) ---
        this.ctx.strokeStyle = isEdgeSel ? '#0d6efd' : this._themeColor('--fe-text-secondary', 'rgba(73, 80, 87, 0.6)');
        this.ctx.lineWidth = isEdgeSel ? 2.5 : 2;
        this.ctx.setLineDash([8, 5]);

        // Use boundary intersection for arrow placement even on dashed lines
        const sC = MathUtils.getCenter(n1),
          eC = MathUtils.getCenter(n2);
        const p1 = n1.isPoint ? { x: n1.x, y: n1.y } : MathUtils.getBoundaryIntersection(eC, sC, n1);
        let p2 = n2.isPoint ? { x: n2.x, y: n2.y } : MathUtils.getBoundaryIntersection(sC, eC, n2);

        // If target is a point, offset arrowhead by 4px (radius) so it doesn't cover the point center
        if (n2.isPoint) {
          const angleToSource = Math.atan2(p1.y - p2.y, p1.x - p2.x);
          p2.x += Math.cos(angleToSource) * 4;
          p2.y += Math.sin(angleToSource) * 4;
        }

        this.ctx.beginPath();
        this.ctx.moveTo(p1.x, p1.y);
        this.ctx.lineTo(p2.x, p2.y);
        this.ctx.stroke();

        // Draw Arrowhead at target boundary
        this.ctx.setLineDash([]);
        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        this.ctx.fillStyle = this.ctx.strokeStyle;
        MathUtils.drawArrowhead(this.ctx, p2, angle, this.settings.arrow_style);

        if (edge.label) {
          this._drawEdgeLabel(edge.label, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
        }
      }

      // Selection Handles - same white-filled circles a selected shape's
      // corners get, so a selected connector is just as clearly "this
      // one" at a glance. Must use whichever points were ACTUALLY drawn
      // (the stub exit/entry points for a routed solid line) rather
      // than always recomputing the raw boundary-intersection point -
      // otherwise the markers land somewhere other than the visible
      // line's real ends.
      if (isEdgeSel) {
        let p1, p2;
        if (isSolid) {
          const stubPoints = this._getStubbedPointsFor(edge, n1, n2, edgeSideInfo);
          if (stubPoints) {
            p1 = stubPoints[0];
            p2 = stubPoints[stubPoints.length - 1];
          }
        }
        if (!p1 || !p2) {
          const sC = MathUtils.getCenter(n1),
            eC = MathUtils.getCenter(n2);
          p1 = n1.isPoint ? { x: n1.x, y: n1.y } : MathUtils.getBoundaryIntersection(eC, sC, n1);
          p2 = n2.isPoint ? { x: n2.x, y: n2.y } : MathUtils.getBoundaryIntersection(sC, eC, n2);
        }
        this.ctx.setLineDash([]);
        MathUtils.drawLineEndpointMarkers(this.ctx, p1, p2);
      }
      this.ctx.restore();
    }

    // Mark every doorway 2+ real edges share (a deliberate fork or merge,
    // drawn as an intentional trunk - see _getJunctionPoints) so it reads
    // as "lines fuse here on purpose" rather than an ambiguous overlap.
    for (const point of this._getJunctionPoints(edgeSideInfo)) {
      MathUtils.drawJunctionDot(this.ctx, point, this.settings.line_color);
    }

    // Preview line while drawing
    if (this.state.isDrawingEdge) {
      const sn = this.state.edgeStartNode;
      const startX = sn ? (sn.isPoint ? sn.x : sn.x + (sn.width || 0) / 2) : this.state.edgeStartPos ? this.state.edgeStartPos.x : this.state.mousePos.x;
      const startY = sn ? (sn.isPoint ? sn.y : sn.y + (sn.height || 0) / 2) : this.state.edgeStartPos ? this.state.edgeStartPos.y : this.state.mousePos.y;

      // Snap preview to nearby port. mousePos only ever has .x/.y (see
      // screenToWorld()) - this read .worldX/.worldY, which is always
      // undefined, so ctx.lineTo(NaN, NaN) silently drew nothing for
      // most of the drag (canvas no-ops non-finite coordinates). Same
      // typo existed in drawMarquee() below.
      let snapX = this.state.mousePos.x;
      let snapY = this.state.mousePos.y;

      if (this.canvasRef && this.canvasRef.el) {
        const lastMx = this.state.lastMouse.x;
        const lastMy = this.state.lastMouse.y;
        for (const node of this.props.canvasData.nodes) {
          if (this.state.edgeStartNode && node.id === this.state.edgeStartNode.id) continue;
          for (const port of this.getNodePorts(node)) {
            const sp = this.worldToClientScreen(port.x, port.y);
            if (Math.hypot(lastMx - sp.x, lastMy - sp.y) <= 14) {
              snapX = port.x;
              snapY = port.y;
              // Glow ring
              this.ctx.save();
              this.ctx.strokeStyle = '#0d6efd';
              this.ctx.lineWidth = 2;
              this.ctx.globalAlpha = 0.8;
              this.ctx.beginPath();
              this.ctx.arc(port.x, port.y, 7, 0, Math.PI * 2);
              this.ctx.stroke();
              this.ctx.restore();
            }
          }
        }
      }

      // Draw dashed preview line
      this.ctx.save();
      this.ctx.globalAlpha = 0.5;
      this.ctx.strokeStyle = '#6c757d';
      this.ctx.setLineDash([6, 4]);
      this.ctx.lineWidth = 1.5;
      this.ctx.beginPath();
      this.ctx.moveTo(startX, startY);
      this.ctx.lineTo(snapX, snapY);
      this.ctx.stroke();
      this.ctx.restore();
    }
  }

  drawMarquee() {
    this.ctx.save();
    this.ctx.strokeStyle = '#0d6efd';
    this.ctx.fillStyle = 'rgba(13, 110, 253, 0.1)';
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([5, 5]);

    const w = this.state.mousePos.x - this.state.marqueeStart.x;
    const h = this.state.mousePos.y - this.state.marqueeStart.y;

    this.ctx.strokeRect(this.state.marqueeStart.x, this.state.marqueeStart.y, w, h);
    this.ctx.fillRect(this.state.marqueeStart.x, this.state.marqueeStart.y, w, h);
    this.ctx.restore();
  }

  // Thin pink guide lines shown while dragging a single shape, marking
  // where its left/center/right (or top/center/bottom) edge lines up
  // with another shape's - computed live in onMouseMove(), not stored.
  drawAlignmentGuides() {
    this.ctx.save();
    this.ctx.strokeStyle = '#ff3b8d';
    this.ctx.lineWidth = 1 / this.camera.zoom;
    this.ctx.setLineDash([4 / this.camera.zoom, 4 / this.camera.zoom]);
    const SPAN = 100000;
    for (const guide of this.state.alignmentGuides) {
      this.ctx.beginPath();
      if (guide.type === 'v') {
        this.ctx.moveTo(guide.pos, -SPAN);
        this.ctx.lineTo(guide.pos, SPAN);
      } else {
        this.ctx.moveTo(-SPAN, guide.pos);
        this.ctx.lineTo(SPAN, guide.pos);
      }
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  // Convert Screen coordinates to World coordinates
  screenToWorld(mx, my) {
    if (!this.canvasRef || !this.canvasRef.el) return { x: mx, y: my };
    const canvas = this.canvasRef.el;
    const rect = canvas.getBoundingClientRect();

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const canvasX = (mx - rect.left) * scaleX;
    const canvasY = (my - rect.top) * scaleY;

    return {
      x: (canvasX - this.camera.x) / this.camera.zoom,
      y: (canvasY - this.camera.y) / this.camera.zoom,
    };
  }

  worldToScreen(wx, wy) {
    // Transform world coordinate to local pixel coordinate relative to
    // canvas top-left. Correct for positioning an HTML element that's a
    // sibling of the canvas inside the same wrapper (the inline text
    // editor, the floating toolbar) - NOT for comparing against a raw
    // mouse event's clientX/clientY, which is page-viewport-relative,
    // not canvas-relative. Use worldToClientScreen() for that.
    return {
      x: wx * this.camera.zoom + this.camera.x,
      y: wy * this.camera.zoom + this.camera.y,
    };
  }

  // The real inverse of screenToWorld(): converts a world coordinate to
  // the same page-viewport-relative space ev.clientX/clientY are in, so
  // it can be compared against them directly. worldToScreen() above is
  // missing both of the corrections this adds (the canvas element's own
  // position on the page, and the CSS-pixel-vs-backing-bitmap-pixel
  // scale) - every hit-test that compared its result against a raw
  // clientX/clientY was therefore off by the canvas's on-page position
  // (typically several hundred px, since this app always docks the
  // canvas next to a sidebar/toolbar, never at the page's own origin),
  // making resize handles, port-snapping while drawing a connector, and
  // drag-to-merge-onto-a-port all effectively unreachable in practice.
  // See chat history 2026-09-06 for the report and the exact reasoning.
  worldToClientScreen(wx, wy) {
    const canvas = this.canvasRef?.el;
    const canvasPos = this.worldToScreen(wx, wy);
    if (!canvas) return canvasPos;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width || 1;
    const scaleY = canvas.height / rect.height || 1;
    return {
      x: canvasPos.x / scaleX + rect.left,
      y: canvasPos.y / scaleY + rect.top,
    };
  }

  /**
   * Centralized hit detection for nodes and points.
   */
  _findHitNode(worldPos) {
    return CanvasInteraction.findHitNode(this, worldPos);
  }

  // Mouse Interactions
  onMouseDown(ev) {
    const mx = ev.clientX;
    const my = ev.clientY;
    const worldPos = this.screenToWorld(mx, my);
    this.state.lastMouse = { x: mx, y: my };
    // Any new click clears a double-click's transient highlight (leaving
    // the shape, per user request 2026-09-10) - a following dblclick
    // re-applies it right after, so a genuine double-click still ends up
    // highlighted despite this running on both of its two mousedowns.
    // The sticky (pinned) highlight lives in a separate set, untouched.
    this._highlightNodeIds.clear();

    // PHASE 1: System Actions (Pan)
    if (ev.button === 1 || (this.state.spaceDown && ev.button === 0)) {
      ev.preventDefault();
      if (ev.button === 1) this.state.isMiddlePan = true;
      else {
        this.state.isSpacePan = true;
        if (this.canvasRef.el) this.canvasRef.el.style.cursor = 'grabbing';
      }
      return;
    }

    // PHASE 1.5: Pan mode is a pure viewport-navigation tool - it must
    // ALWAYS move the camera on left-click-drag and NEVER select, drag,
    // resize or edit anything, regardless of what's under the cursor.
    // Previously this mode wasn't excluded from the marquee-selection
    // fallback further down, so a left-click-drag on empty space while
    // "Pan" was active started a marquee box instead of panning.
    if (this.props.mode === 'pan' && ev.button === 0) {
      this.state.isDraggingCanvas = true;
      if (this.canvasRef.el) this.canvasRef.el.style.cursor = 'grabbing';
      return;
    }

    // PHASE 2: UI Interactions (Resize handles)
    if (this.props.mode !== 'pan') {
      const node = this._handleResizeDetection(mx, my, ev.ctrlKey);
      if (node) return; // Resize logic handled and returned
    }

    // PHASE 3: Hit Detection (PRIORITY: 1. Edge Handles, 2. Nodes, 3. Edge Bodies)

    // 1. Check for Edge Handles (PRIORITY #1: Across all edges for direct control)
    if (this.props.mode === 'select' || this.props.mode === 'draw_text') {
      for (const edge of this.props.canvasData.edges) {
        const n1 = this.getNode(edge.sourceNode || edge.source);
        const n2 = this.getNode(edge.targetNode || edge.target);
        if (!n1 || !n2) continue;

        const sC = MathUtils.getCenter(n1),
          eC = MathUtils.getCenter(n2);
        const p1 = n1.isPoint ? { x: n1.x, y: n1.y } : MathUtils.getBoundaryIntersection(eC, sC, n1);
        const p2 = n2.isPoint ? { x: n2.x, y: n2.y } : MathUtils.getBoundaryIntersection(sC, eC, n2);

        // Increase hit radius to 20 for maximum ease of use
        if (Math.hypot(worldPos.x - p1.x, worldPos.y - p1.y) <= 20) {
          this.state.selectedEdge = edge;
          this.state.selectedNodes.clear(); // Ensure we don't drag nodes
          this.state.isDraggingEdgeHandle = true;
          this.state.draggingEdge = edge;
          this.state.draggingEndpoint = 'start';
          if (this.props.setActiveEdgeId) this.props.setActiveEdgeId(edge.id);
          return;
        }
        if (Math.hypot(worldPos.x - p2.x, worldPos.y - p2.y) <= 20) {
          this.state.selectedEdge = edge;
          this.state.selectedNodes.clear(); // Ensure we don't drag nodes
          this.state.isDraggingEdgeHandle = true;
          this.state.draggingEdge = edge;
          this.state.draggingEndpoint = 'target';
          if (this.props.setActiveEdgeId) this.props.setActiveEdgeId(edge.id);
          return;
        }
      }
    }

    // 2. Check for Nodes
    const hitNode = this._findHitNode(worldPos);
    if (ev.button === 0 && hitNode) {
      if (this.props.mode === 'draw_pen') {
        // PEN MODE: clicking a shape = start drawing a connector FROM it
        // Do NOT drag the node. Start edge drawing immediately.
        this.state.isDraggingNode = false;
        this.state.selectedNodes.clear();
        this._updateActiveNode(hitNode.id);
        this._startEdgeDrawing(hitNode, worldPos, mx, my);
        // Immediately set isDrawingEdge = true so any drag starts rendering the line
        this.state.isDrawingEdge = true;
        this.state.edgeStartPos = MathUtils.getCenter(hitNode);
        return;
      }

      if (!ev.shiftKey && !this.state.selectedNodes.has(hitNode.id)) {
        this.state.selectedNodes.clear();
      }
      this.state.selectedNodes.add(hitNode.id);
      this.state.isDraggingNode = true;
      this.state.dragStart = { ...worldPos };
      this.state.activeNode = hitNode;
      this._updateActiveNode(hitNode.id);
      if (this.props.setActiveEdgeId) this.props.setActiveEdgeId(null);

      if (this.props.mode === 'draw_text') {
        this._startInlineEditing(hitNode);
      } else if (this.props.mode === 'select') {
        // Long-press (hold without meaningfully moving) opens a shape
        // picker to change this node's type directly, instead of having
        // to delete and recreate it. Cancelled in onMouseMove() if the
        // press turns into a real drag, and always cleared in
        // onMouseUp().
        this._longPressStartPos = { x: mx, y: my };
        if (this._longPressTimer) clearTimeout(this._longPressTimer);
        this._longPressTimer = setTimeout(() => {
          this._longPressTimer = null;
          this._openShapePicker(hitNode, mx, my);
        }, this.settings.longpress_duration_ms);
      }
      return;
    }

    // 3. Check for Edge Bodies
    const hitEdge = this._findHitEdge(worldPos);
    if (hitEdge && (this.props.mode === 'select' || this.props.mode === 'draw_text')) {
      this.state.selectedEdge = hitEdge;
      this.state.isDraggingEdge = true;
      if (this.props.setActiveEdgeId) this.props.setActiveEdgeId(hitEdge.id);
      this.state.selectedNodes.clear();
      if (this.props.mode === 'draw_text') this._startInlineEditing(hitEdge);
      return;
    }

    // PHASE 4: Canvas Actions (Pan & Marquee)
    if (ev.button === 1 || ev.button === 2) {
      this.state.isDraggingCanvas = true;
      if (this.canvasRef.el) this.canvasRef.el.style.cursor = 'grabbing';
      return;
    }

    if (ev.button === 0) {
      this.state.selectedNodes.clear();
      this.state.selectedEdge = null;
      if (this.props.setActiveNodeId) this.props.setActiveNodeId(null);
      if (this.props.setActiveEdgeId) this.props.setActiveEdgeId(null);

      if (this.state.spaceDown) {
        this.state.isDraggingCanvas = true;
        if (this.canvasRef.el) this.canvasRef.el.style.cursor = 'grabbing';
      } else {
        this.state.isMarquee = true;
        this.state.marqueeStart = { ...worldPos, screenX: mx, screenY: my };
      }
    }

    // PHASE 5: Empty Space Interactions
    if (this.props.mode === 'draw_text') {
      const newNode = {
        id: MathUtils.uuidv4(),
        x: worldPos.x - 50,
        y: worldPos.y - 15,
        width: 100,
        height: 30,
        // Pure text, no shape/background/border - see _drawNode()'s
        // `type === 'text'` case, which deliberately draws nothing but
        // the label. Was 'comment', which drew a full speech-bubble
        // behind it - unusable for labeling a line since the bubble
        // covered whatever was underneath.
        type: 'text',
        label: 'Type text...',
        fontSize: String(this.settings.comment_font_size),
        bold: false,
        italic: false,
      };
      this.props.canvasData.nodes.push(newNode);
      this.state.selectedNodes.clear();
      this.state.selectedNodes.add(newNode.id);
      this.state.showFloatingToolbar = true;
      this.state.floatingToolbarPos = { x: mx, y: my };
      if (this.props.onChange) this.props.onChange();
      return;
    }

    if (this.props.mode === 'draw_pen') {
      // Create a new start point IMMEDIATELY when clicking in space
      // Use exact coordinates as center (no offsets)
      const startNode = {
        id: MathUtils.uuidv4(),
        x: worldPos.x,
        y: worldPos.y,
        width: 8,
        height: 8,
        type: 'start_end',
        isPoint: true,
        label: '',
      };
      if (!this.props.canvasData.nodes) this.props.canvasData.nodes = [];
      this.props.canvasData.nodes.push(startNode);

      this._startEdgeDrawing(startNode, worldPos, mx, my);
      if (this.props.onChange) this.props.onChange();
      return;
    }

    if (this.props.mode === 'draw_comment_shape') {
      // Comment shapes are sized by drawing them (click-drag), unlike
      // Flow shapes which get a fixed default size on a single click -
      // a Comment can be any size/proportion since it's just an
      // annotation, not a typed flow step.
      const newNode = {
        id: MathUtils.uuidv4(),
        x: worldPos.x,
        y: worldPos.y,
        width: 1,
        height: 1,
        type: 'process',
        color: '#e2e8f0',
        label: 'Comment',
        isCommentCategory: true,
      };
      if (!this.props.canvasData.nodes) this.props.canvasData.nodes = [];
      this.props.canvasData.nodes.push(newNode);
      this.state.isDrawingCommentShape = true;
      this.state.commentDrawNode = newNode;
      this.state.commentDrawStart = { x: worldPos.x, y: worldPos.y };
      return;
    }

    if (this.props.mode.startsWith('draw_') && this.props.mode !== 'draw_pen') {
      this._createNewShape(this.props.mode, worldPos);
      return;
    }

    // Check for comment edge selection (Line body)
    if (this._handleEdgeSelection(ev, worldPos)) return;

    // Finally: Marquee selection ('pan' mode never reaches here - it
    // returns immediately at the top of this method)
    if (ev.button === 0 && this.props.mode === 'select') {
      if (!ev.shiftKey && !ev.ctrlKey) this.state.selectedNodes.clear();
      this.state.isMarquee = true;
      this.state.marqueeStart = { x: worldPos.x, y: worldPos.y, screenX: mx, screenY: my };
    }
  }

  // Holding Ctrl widens the grab zone around each resize handle (still
  // just the 4 corners, not a new capability - resizing already worked
  // without Ctrl) so hitting it precisely on a small shape is easier.
  _handleResizeDetection(mx, my, wideGrab = false) {
    const SNAP_PX = wideGrab ? 20 : 8;
    for (const node of this.props.canvasData.nodes) {
      if (!this.state.selectedNodes.has(node.id)) continue;
      for (const h of this._getResizeHandles(node)) {
        const sh = this.worldToClientScreen(h.x, h.y);
        if (Math.hypot(mx - sh.x, my - sh.y) <= SNAP_PX) {
          this.state.isResizingNode = true;
          this.state.resizeNode = node;
          this.state.resizeHandle = h.dir;
          this.state.resizeStart = { mx, my, x: node.x, y: node.y, w: node.width, h: node.height };
          return node;
        }
      }
    }
    return null;
  }

  _startEdgeDrawing(startNode, worldPos, mx, my) {
    this.state.isPenDown = true;
    this.state.edgeStartNode = startNode;
    this.state.edgeStartPos = { x: worldPos.x, y: worldPos.y };
    this.state.penStartPos = { x: worldPos.x, y: worldPos.y, screenX: mx, screenY: my };
  }

  _createNewShape(mode, worldPos) {
    const typeMap = {
      draw_oval: 'start_end',
      draw_start_end: 'start_end',
      draw_rect: 'process',
      draw_process: 'process',
      draw_diamond: 'decision',
      draw_decision: 'decision',
      draw_para: 'data',
      draw_data: 'data',
      draw_comment: 'comment',
      draw_comment_shape: 'process',
      draw_text: 'text',
    };

    // Default color per shape type (matches toolbar icon colors)
    const colorMap = {
      draw_oval:       '#a8e6cf',  // green  — Start/End
      draw_start_end:  '#a8e6cf',  // green  — Start/End
      draw_rect:       '#bae1ff',  // blue   — Process
      draw_process:    '#bae1ff',  // blue   — Process
      draw_diamond:    '#ffffba',  // yellow — Decision
      draw_decision:   '#ffffba',  // yellow — Decision
      draw_para:       '#e0bbe4',  // purple — I/O
      draw_data:       '#e0bbe4',  // purple — I/O
      draw_comment:    '#fff9c4',  // pale   — Comment
      draw_comment_shape: '#e2e8f0', // muted grey — Comment (category, not a shape)
    };

    const isComment = mode === 'draw_comment';
    // "Comment category" is independent of shape (node.type): a comment
    // can be any of the flow shapes (rectangle, diamond, ...), it's just
    // not part of the flow logic - see _drawNode()'s dashed-border
    // treatment and the long-press shape picker, both of which work the
    // same regardless of which base shape a comment node uses.
    const isCommentCategory = mode === 'draw_comment_shape';
    // A plain Comment's shape comes from Settings (flow_default_comment_shape
    // / a diagram's own override) rather than always being a speech bubble.
    // Every other mode already names an explicit shape via typeMap, so the
    // `default_flow_shape` fallback below is only ever reached for a mode
    // that isn't in the map at all - kept for correctness/consistency
    // rather than because any current toolbar button relies on it.
    const nodeType = isComment ? this.settings.default_comment_shape : typeMap[mode] || this.settings.default_flow_shape;
    const nodeColor = colorMap[mode] || '#bae1ff';
    const defW = this.settings.default_shape_width;
    const defH = this.settings.default_shape_height;

    const newNode = {
      id: MathUtils.uuidv4(),
      x: worldPos.x - defW / 2,
      y: worldPos.y - defH / 2,
      width: isComment ? Math.round(defW * 1.08) : (nodeType === 'decision' ? Math.round(defW * 0.92) : defW),
      height: isComment ? Math.round(defH * 1.4) : (nodeType === 'decision' ? Math.round(defH * 1.4) : defH),
      type: nodeType,
      color: nodeColor,
      label: mode === 'draw_text' ? 'Text' : isComment ? '?' : isCommentCategory ? 'Comment' : 'New Node',
      isCommentCategory: isCommentCategory,
      fontSize: String((isComment || isCommentCategory) ? this.settings.comment_font_size : this.settings.default_font_size),
    };
    if (!this.props.canvasData.nodes) this.props.canvasData.nodes = [];
    this.props.canvasData.nodes.push(newNode);
    this.enforceCollision(newNode);

    if (this.props.setMode) this.props.setMode('select');
    this.state.isDraggingNode = true;
    this.state.activeNode = newNode;
    this._updateActiveNode(newNode.id);
    this.state.selectedNodes.clear();
    this.state.selectedNodes.add(newNode.id);
    if (this.props.onChange) this.props.onChange();
  }

  _handleEdgeSelection(ev, worldPos) {
    for (const edge of this.props.canvasData.edges) {
      const n1 = this.getNode(edge.sourceNode || edge.source);
      const n2 = this.getNode(edge.targetNode || edge.target);
      if (!n1 || !n2) continue;

      const sC = MathUtils.getCenter(n1),
        eC = MathUtils.getCenter(n2);
      // For formal (orthogonal) paths, we check intersection with the stepped segments
      let hit = false;
      const isFormal = !n1.isPoint && !n2.isPoint;

      if (isFormal) {
        const segments = this._getOrthogonalSegments(n1, n2);
        for (const seg of segments) {
          const s1 = this.worldToScreen(seg.x1, seg.y1);
          const s2 = this.worldToScreen(seg.x2, seg.y2);
          if (this._pointToSegmentDist(ev.clientX, ev.clientY, s1.x, s1.y, s2.x, s2.y) <= 8) {
            hit = true;
            break;
          }
        }
      } else {
        const s1 = this.worldToScreen(n1.x, n1.y);
        const s2 = this.worldToScreen(n2.x, n2.y);
        if (this._pointToSegmentDist(ev.clientX, ev.clientY, s1.x, s1.y, s2.x, s2.y) <= 8) hit = true;
      }

      if (hit) {
        this.state.selectedEdge = edge;
        if (this.props.setActiveEdgeId) this.props.setActiveEdgeId(edge.id);

        // Unified Movement: When dragging the BODY, select the body and BOTH endpoints
        if (!ev.shiftKey && !ev.ctrlKey) this.state.selectedNodes.clear();
        if (edge.sourceNode) this.state.selectedNodes.add(edge.sourceNode);
        if (edge.targetNode) this.state.selectedNodes.add(edge.targetNode);
        return true;
      }
    }
    return false;
  }

  _updateActiveNode(nodeId) {
    if (this.props.setActiveNodeId) {
      this.props.setActiveNodeId(nodeId);
    }
  }

  _findHitEdge(worldPos) {
    return CanvasInteraction.findHitEdge(this, worldPos);
  }

  _pointToSegmentDist(px, py, x1, y1, x2, y2) {
    return CanvasInteraction.pointToSegmentDist(px, py, x1, y1, x2, y2);
  }

  _getOrthogonalSegments(startNode, endNode) {
    return CanvasInteraction.getOrthogonalSegments(startNode, endNode);
  }

  _drawEdgeLabel(text, x, y) {
    this.ctx.save();
    this.ctx.font = '500 12px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    const tw = this.ctx.measureText(text).width;
    this.ctx.fillStyle = this._themeColor('--fe-bg-surface', '#ffffff');
    this.ctx.globalAlpha = 0.9;
    this.ctx.fillRect(x - tw / 2 - 4, y - 8, tw + 8, 16);
    this.ctx.globalAlpha = 1;
    this.ctx.fillStyle = this._themeColor('--fe-text-primary', '#1e293b');
    this.ctx.fillText(text, x, y);
    this.ctx.restore();
  }

  onMouseMove(ev) {
    const mx = ev.clientX;
    const my = ev.clientY;
    const worldPos = this.screenToWorld(mx, my);
    this.state.mousePos = worldPos;

    const dx = mx - this.state.lastMouse.x;
    const dy = my - this.state.lastMouse.y;
    const wdx = dx / this.camera.zoom;
    const wdy = dy / this.camera.zoom;

    // A real drag (moved more than a few px since mousedown) means this
    // is a drag, not a long-press-and-hold - cancel the pending shape
    // picker timer so it doesn't pop up mid-drag.
    if (this._longPressTimer && this._longPressStartPos) {
      const movedDist = Math.hypot(mx - this._longPressStartPos.x, my - this._longPressStartPos.y);
      if (movedDist > 6) {
        clearTimeout(this._longPressTimer);
        this._longPressTimer = null;
      }
    }

    if (this.state.isDrawingCommentShape && this.state.commentDrawNode) {
      const n = this.state.commentDrawNode;
      const start = this.state.commentDrawStart;
      n.x = Math.min(start.x, worldPos.x);
      n.y = Math.min(start.y, worldPos.y);
      n.width = Math.max(1, Math.abs(worldPos.x - start.x));
      n.height = Math.max(1, Math.abs(worldPos.y - start.y));
    }

    if (this.state.isMarquee) {
      const left = Math.min(this.state.marqueeStart.x, worldPos.x);
      const right = Math.max(this.state.marqueeStart.x, worldPos.x);
      const top = Math.min(this.state.marqueeStart.y, worldPos.y);
      const bottom = Math.max(this.state.marqueeStart.y, worldPos.y);

      const newSelection = new Set();
      for (const node of this.props.canvasData.nodes) {
        const nw = node.isPoint ? 10 : node.width || 100;
        const nh = node.isPoint ? 10 : node.height || 50;
        const nx = node.isPoint ? node.x - 5 : node.x;
        const ny = node.isPoint ? node.y - 5 : node.y;
        const intersects = nx < right && nx + nw > left && ny < bottom && ny + nh > top;
        if (intersects) newSelection.add(node.id);
      }
      this.state.selectedNodes = newSelection;
      // Note: We don't return here so the marquee rectangle can update its drawing state
    }

    // Transition from Pen Click to Edge Draw (Long Press Drag with Port Snap)
    if (this.state.isPenDown && !this.state.isDrawingEdge && this.props.mode === 'draw_pen') {
      const dist = Math.hypot(mx - this.state.penStartPos.screenX, my - this.state.penStartPos.screenY);
      if (dist > 8) {
        this.state.isDrawingEdge = true;
        this.state.edgeStartPos = { x: this.state.penStartPos.x, y: this.state.penStartPos.y };

        // Smart Port Snap for Start Point
        for (const node of this.props.canvasData.nodes) {
          if (MathUtils.isPointInRect(this.state.penStartPos.x, this.state.penStartPos.y, node)) {
            const ports = this.getNodePorts(node);
            let bestPort = ports[0];
            let minDist = Infinity;
            ports.forEach((p) => {
              const d = Math.hypot(this.state.penStartPos.x - p.x, this.state.penStartPos.y - p.y);
              if (d < minDist) {
                minDist = d;
                bestPort = p;
              }
            });
            this.state.edgeStartNode = node;
            this.state.edgeStartPos = bestPort;
            break;
          }
        }
      }
    }

    if (this.state.isMarquee) {
      this.state.marqueeEnd = { x: worldPos.x, y: worldPos.y, screenX: mx, screenY: my };
      return;
    }

    if (this.state.isDraggingCanvas || this.state.isMiddlePan || this.state.isSpacePan) {
      this.camera.x += dx;
      this.camera.y += dy;
      if (this.props.onTransformChange) {
        this.props.onTransformChange({ x: this.camera.x, y: this.camera.y, zoom: this.camera.zoom });
      }
      if (this.canvasRef.el && !this.state.isSpacePan) this.canvasRef.el.style.cursor = 'grabbing';
    } else if (this.state.isResizingNode && this.state.resizeNode) {
      const MIN_W = 40,
        MIN_H = 30;
      const s = this.state.resizeStart;
      const ddx = (mx - s.mx) / this.camera.zoom;
      const ddy = (my - s.my) / this.camera.zoom;
      const node = this.state.resizeNode;
      const dir = this.state.resizeHandle;

      // North (top) anchors
      if (dir.includes('n')) {
        const newH = Math.max(MIN_H, s.h - ddy);
        node.y = s.y + (s.h - newH);
        node.height = newH;
      }
      // South (bottom) anchors
      if (dir.includes('s')) {
        node.height = Math.max(MIN_H, s.h + ddy);
      }
      // West (left) anchors
      if (dir.includes('w')) {
        const newW = Math.max(MIN_W, s.w - ddx);
        node.x = s.x + (s.w - newW);
        node.width = newW;
      }
      // East (right) anchors
      if (dir.includes('e')) {
        node.width = Math.max(MIN_W, s.w + ddx);
      }
    } else if (this.state.isDraggingEdgeHandle && this.state.draggingEdge) {
      const edge = this.state.draggingEdge;
      const endpoint = this.state.draggingEndpoint;
      const currentId = endpoint === 'start' ? edge.sourceNode || edge.source : edge.targetNode || edge.target;
      const node = this.getNode(currentId);

      // 1. ALWAYS move the point to follow the mouse if it's a point
      if (node && node.isPoint) {
        node.x = worldPos.x;
        node.y = worldPos.y;

        // Apply boundary exclusion for the point while dragging
        for (const other of this.props.canvasData.nodes) {
          if (other.id === node.id || other.isPoint) continue;
          const ow = other.width || 120,
            oh = other.height || 80;
          const isEllipse = other.type === 'start' || other.type === 'end' || other.type === 'process_oval';
          let isInside = isEllipse
            ? Math.pow(node.x - (other.x + ow / 2), 2) / Math.pow(ow / 2, 2) + Math.pow(node.y - (other.y + oh / 2), 2) / Math.pow(oh / 2, 2) <= 1
            : node.x >= other.x && node.x <= other.x + ow && node.y >= other.y && node.y <= other.y + oh;
          if (isInside) {
            const boundary = MathUtils.getBoundaryIntersection(node, MathUtils.getCenter(other), other);
            node.x = boundary.x;
            node.y = boundary.y;
            break;
          }
        }
      } else {
        // If it was connected to a tool, we need to "Pull Out"
        const center = MathUtils.getCenter(node);
        const boundary = MathUtils.getBoundaryIntersection(worldPos, center, node);
        if (Math.hypot(worldPos.x - boundary.x, worldPos.y - boundary.y) > 30) {
          const newPoint = { id: MathUtils.uuidv4(), x: worldPos.x, y: worldPos.y, isPoint: true };
          this.props.canvasData.nodes.push(newPoint);
          if (endpoint === 'start') {
            edge.sourceNode = newPoint.id;
            delete edge.source;
          } else {
            edge.targetNode = newPoint.id;
            delete edge.target;
          }
        }
      }
      // No onChange() here: this fires on every mousemove frame while
      // dragging (60-100+/sec), and onChange() triggers a full JSON
      // serialize + localStorage write + minimap redraw in the parent -
      // doing that per-frame is what caused the drag lag. The canvas
      // itself keeps redrawing every frame via the independent
      // renderLoop() rAF, so dragging stays visually smooth; the single
      // commit for persistence/history/minimap happens once in
      // onMouseUp() when the drag actually ends.
    } else if (this.state.isDraggingEdge && this.state.selectedEdge) {
      const wdx = dx / this.camera.zoom;
      const wdy = dy / this.camera.zoom;
      const edge = this.state.selectedEdge;
      const n1 = this.getNode(edge.sourceNode || edge.source);
      const n2 = this.getNode(edge.targetNode || edge.target);
      if (n1) {
        n1.x += wdx;
        n1.y += wdy;
      }
      if (n2) {
        n2.x += wdx;
        n2.y += wdy;
      }
    } else if (this.state.isDraggingNode && this.state.selectedNodes.size > 0) {
      const wdx = dx / this.camera.zoom;
      const wdy = dy / this.camera.zoom;
      this.state.alignmentGuides = [];
      // Alignment guides only make sense with exactly one shape being
      // dragged (a multi-select bounding-box version would need its own
      // reference edges, not attempted here).
      const singleId = this.state.selectedNodes.size === 1 ? [...this.state.selectedNodes][0] : null;

      for (const nodeId of this.state.selectedNodes) {
        const node = this.getNode(nodeId);
        if (!node) continue;

        let nextX = node.x + wdx;
        let nextY = node.y + wdy;

        if (!node.isPoint && nodeId === singleId && this.props.magneticSnap) {
          const w = node.width || 100;
          const h = node.height || 50;
          const threshold = 6 / this.camera.zoom;
          const candX = [nextX, nextX + w / 2, nextX + w];
          const candY = [nextY, nextY + h / 2, nextY + h];
          let bestVDelta = null, bestVPos = null;
          let bestHDelta = null, bestHPos = null;

          for (const other of this.props.canvasData.nodes) {
            if (other.id === node.id || other.isPoint) continue;
            const ow = other.width || 100;
            const oh = other.height || 50;
            const otherXs = [other.x, other.x + ow / 2, other.x + ow];
            const otherYs = [other.y, other.y + oh / 2, other.y + oh];

            for (const cx of candX) {
              for (const ox of otherXs) {
                const delta = ox - cx;
                if (Math.abs(delta) < threshold && (bestVDelta === null || Math.abs(delta) < Math.abs(bestVDelta))) {
                  bestVDelta = delta;
                  bestVPos = ox;
                }
              }
            }
            for (const cy of candY) {
              for (const oy of otherYs) {
                const delta = oy - cy;
                if (Math.abs(delta) < threshold && (bestHDelta === null || Math.abs(delta) < Math.abs(bestHDelta))) {
                  bestHDelta = delta;
                  bestHPos = oy;
                }
              }
            }
          }

          if (bestVDelta !== null) {
            nextX += bestVDelta;
            this.state.alignmentGuides.push({ type: 'v', pos: bestVPos });
          }
          if (bestHDelta !== null) {
            nextY += bestHDelta;
            this.state.alignmentGuides.push({ type: 'h', pos: bestHPos });
          }
        }

        if (node.isPoint && !ev.altKey) {
          // Snap the segment to this point's connected neighbor to
          // horizontal/vertical when it's already close to one of those
          // angles - hold Alt while dragging to keep a free diagonal
          // angle instead. Only the first connected edge is considered;
          // a point with several connections keeps whichever one was
          // found first as the reference.
          const relatedEdge = this.props.canvasData.edges.find(
            (e) => (e.sourceNode || e.source) === node.id || (e.targetNode || e.target) === node.id,
          );
          if (relatedEdge) {
            const otherId = (relatedEdge.sourceNode || relatedEdge.source) === node.id ? relatedEdge.targetNode || relatedEdge.target : relatedEdge.sourceNode || relatedEdge.source;
            const neighbor = this.getNode(otherId);
            if (neighbor) {
              const nc = neighbor.isPoint ? { x: neighbor.x, y: neighbor.y } : MathUtils.getCenter(neighbor);
              const ddx = nextX - nc.x;
              const ddy = nextY - nc.y;
              if (ddx !== 0 || ddy !== 0) {
                const angleFromHorizontal = (Math.atan2(Math.abs(ddy), Math.abs(ddx)) * 180) / Math.PI;
                const SNAP_ANGLE = 15;
                if (angleFromHorizontal < SNAP_ANGLE) {
                  nextY = nc.y;
                } else if (angleFromHorizontal > 90 - SNAP_ANGLE) {
                  nextX = nc.x;
                }
              }
            }
          }
        }

        if (node.isPoint) {
          for (const other of this.props.canvasData.nodes) {
            if (other.id === node.id || other.isPoint) continue;

            const ow = other.width || 120,
              oh = other.height || 80;
            const isEllipse = other.type === 'start' || other.type === 'end' || other.type === 'process_oval';

            let isInside = false;
            if (isEllipse) {
              const rx = ow / 2,
                ry = oh / 2;
              const cx = other.x + rx,
                cy = other.y + ry;
              isInside = Math.pow(nextX - cx, 2) / Math.pow(rx, 2) + Math.pow(nextY - cy, 2) / Math.pow(ry, 2) <= 1;
            } else {
              isInside = nextX >= other.x && nextX <= other.x + ow && nextY >= other.y && nextY <= other.y + oh;
            }

            if (isInside) {
              const center = MathUtils.getCenter(other);
              const boundary = MathUtils.getBoundaryIntersection({ x: nextX, y: nextY }, center, other);
              nextX = boundary.x;
              nextY = boundary.y;
              break;
            }
          }
        }
        node.x = nextX;
        node.y = nextY;
      }
      // Same reasoning as the edge-handle-drag branch above: commit once
      // in onMouseUp() instead of on every mousemove frame.
    } else if (this.state.isMarquee) {
      const left = Math.min(this.state.marqueeStart.x, worldPos.x);
      const right = Math.max(this.state.marqueeStart.x, worldPos.x);
      const top = Math.min(this.state.marqueeStart.y, worldPos.y);
      const bottom = Math.max(this.state.marqueeStart.y, worldPos.y);

      this.state.selectedNodes.clear();
      for (const node of this.props.canvasData.nodes) {
        // Points are 8x8 centered at x,y. Shapes have width/height from x,y.
        const nx = node.isPoint ? node.x - 4 : node.x;
        const ny = node.isPoint ? node.y - 4 : node.y;
        const nw = node.isPoint ? 8 : node.width || 100;
        const nh = node.isPoint ? 8 : node.height || 50;

        const intersects = !(nx > right || nx + nw < left || ny > bottom || ny + nh < top);
        if (intersects) {
          this.state.selectedNodes.add(node.id);
        }
      }
    }

    // --- Cursor Feedback (Resize & Pan) ---
    if (this.props.mode === 'select' && !this.state.isResizingNode && !this.state.isDraggingNode && !this.state.isDrawingEdge) {
      let hoveredHandle = null;
      for (const node of this.props.canvasData.nodes) {
        if (!this.state.selectedNodes.has(node.id) || node.isPoint) continue;
        for (const h of this._getResizeHandles(node)) {
          const sh = this.worldToClientScreen(h.x, h.y);
          if (Math.hypot(mx - sh.x, my - sh.y) <= 8) {
            hoveredHandle = h.dir;
            break;
          }
        }
        if (hoveredHandle) break;
      }
      if (this.canvasRef.el) {
        const cursorMap = {
          nw: 'nwse-resize',
          se: 'nwse-resize',
          ne: 'nesw-resize',
          sw: 'nesw-resize',
          n: 'ns-resize',
          s: 'ns-resize',
          e: 'ew-resize',
          w: 'ew-resize',
        };
        this.canvasRef.el.style.cursor = hoveredHandle ? cursorMap[hoveredHandle] : this.state.spaceDown ? 'grab' : '';
      }
    }

    this.state.lastMouse = { x: mx, y: my };

    // --- Hover Detection ---
    const hitNode = this._findHitNode(worldPos);
    this.state.hoveredNodeId = hitNode ? hitNode.id : null;

    if (!hitNode) {
      const hitEdge = this._findHitEdge(worldPos);
      this.state.hoveredEdgeId = hitEdge ? hitEdge.id : null;
    } else {
      this.state.hoveredEdgeId = null;
    }

    if (this.state.showFloatingToolbar && this.state.selectedNodes.size === 1) {
      const node = this.getNode(Array.from(this.state.selectedNodes)[0]);
      if (node) {
        const screenPos = this.worldToScreen(node.x + (node.width || 0) / 2, node.y);
        this.state.floatingToolbarPos = screenPos;
      }
    }
  }

  onMouseUp(ev) {
    const mx = ev.clientX;
    const my = ev.clientY;
    const worldPos = this.screenToWorld(mx, my);

    // The click ended before the long-press timer fired (a normal
    // click/drag) - nothing more to do with it.
    if (this._longPressTimer) {
      clearTimeout(this._longPressTimer);
      this._longPressTimer = null;
    }

    if (this.state.isDrawingCommentShape) {
      this.state.isDrawingCommentShape = false;
      const n = this.state.commentDrawNode;
      this.state.commentDrawNode = null;
      if (n) {
        // A plain click with no real drag - fall back to a sensible
        // default size instead of leaving a near-invisible sliver.
        if (n.width < 24 && n.height < 24) {
          n.width = 120;
          n.height = 50;
        }
        if (this.props.setMode) this.props.setMode('select');
        this.state.selectedNodes.clear();
        this.state.selectedNodes.add(n.id);
        this._updateActiveNode(n.id);
        if (this.props.onChange) this.props.onChange();
      }
      return;
    }

    // --- Finalize node drag (Smart Merging) ---
    if (this.state.isDraggingNode && this.state.activeNode && this.state.activeNode.isPoint) {
      const draggedNode = this.state.activeNode;
      let mergeTarget = null;

      // 1. Check for other Free Points (Fusion) ONLY
      for (const node of this.props.canvasData.nodes) {
        if (node.id !== draggedNode.id && node.isPoint) {
          const dist = Math.hypot(draggedNode.x - node.x, draggedNode.y - node.y);
          // Precise merging: 8px threshold
          if (dist < 8) {
            mergeTarget = node;
            break;
          }
        }
      }

      if (mergeTarget) {
        // FUSION: Merge draggedNode into mergeTarget
        this.props.canvasData.edges.forEach((edge) => {
          if (edge.sourceNode === draggedNode.id) edge.sourceNode = mergeTarget.id;
          if (edge.targetNode === draggedNode.id) edge.targetNode = mergeTarget.id;
        });

        // Clean up self-edges
        this.props.canvasData.edges = this.props.canvasData.edges.filter((e) => !(e.sourceNode === mergeTarget.id && e.targetNode === mergeTarget.id));

        this.props.canvasData.nodes = this.props.canvasData.nodes.filter((n) => n.id !== draggedNode.id);
        this.state.selectedNodes.clear();
        this.state.selectedNodes.add(mergeTarget.id);
        this.state.activeNode = mergeTarget;
        if (this.props.onChange) this.props.onChange();
      }
    }

    // Finalize edge handle drag (Snap to Tools)
    if (this.state.isDraggingEdgeHandle && this.state.draggingEdge) {
      const edge = this.state.draggingEdge;
      const endpoint = this.state.draggingEndpoint;
      const currentId = endpoint === 'start' ? edge.sourceNode || edge.source : edge.targetNode || edge.target;
      const node = this.getNode(currentId);

      if (node && node.isPoint) {
        // Look for final snap target
        let snapTargetId = null;
        for (const other of this.props.canvasData.nodes) {
          if (other.id === node.id || other.isPoint) continue;
          for (const port of this.getNodePorts(other)) {
            if (Math.hypot(node.x - port.x, node.y - port.y) <= 25) {
              snapTargetId = other.id;
              break;
            }
          }
          if (snapTargetId) break;
        }

        if (snapTargetId) {
          // Commit connection to tool
          if (endpoint === 'start') {
            edge.sourceNode = snapTargetId;
            delete edge.source;
          } else {
            edge.targetNode = snapTargetId;
            delete edge.target;
          }
          // Delete the temporary point node
          this.props.canvasData.nodes = this.props.canvasData.nodes.filter((n) => n.id !== node.id);
        }
      }
    }

    // Single commit point for a finished node/edge/edge-handle drag: one
    // onChange() covering persistence (dirty flag + save) and the undo
    // history entry, instead of one per mousemove frame during the drag.
    // Position mutations already happened live in onMouseMove(); this
    // just notifies the parent the gesture is done.
    if (this.state.isDraggingNode || this.state.isDraggingEdge || this.state.isDraggingEdgeHandle) {
      if (this.props.onChange) this.props.onChange();
    }

    this.state.isDraggingNode = false;
    this.state.isDraggingEdge = false;
    this.state.isDraggingEdgeHandle = false;
    this.state.isDraggingCanvas = false;
    this.state.alignmentGuides = [];
    this.state.draggingEdge = null;
    this.state.draggingEndpoint = null;

    // Release middle-click pan
    if (ev.button === 1 && this.state.isMiddlePan) {
      this.state.isMiddlePan = false;
      return;
    }

    // Release space pan
    if (this.state.isSpacePan) {
      this.state.isSpacePan = false;
      if (this.canvasRef.el) this.canvasRef.el.style.cursor = this.state.spaceDown ? 'grab' : '';
      return;
    }

    // Finalize resize
    if (this.state.isResizingNode) {
      this.state.isResizingNode = false;
      this.state.resizeNode = null;
      this.state.resizeHandle = null;
      this.state.resizeStart = null;
      if (this.props.onChange) this.props.onChange();
      return;
    }

    // Finalize Pen Tool (Pen Mode)
    if (this.state.isPenDown && this.props.mode === 'draw_pen') {
      this.state.isPenDown = false;
      const dist = Math.hypot(mx - this.state.penStartPos.screenX, my - this.state.penStartPos.screenY);

      if (this.state.isDrawingEdge) {
        // Find end node — generous hit radius so connecting shapes is easy
        let endNode = null;
        const HIT_RADIUS = 40; // large snap zone
        let bestDist = HIT_RADIUS;
        for (const node of this.props.canvasData.nodes) {
          if (node.isPoint) continue; // skip waypoints
          const cx = node.x + (node.width || 0) / 2;
          const cy = node.y + (node.height || 0) / 2;
          const d = Math.hypot(worldPos.x - cx, worldPos.y - cy);
          // Also check bounding box
          const inBox = worldPos.x >= node.x - 12 && worldPos.x <= node.x + (node.width || 0) + 12 &&
                        worldPos.y >= node.y - 12 && worldPos.y <= node.y + (node.height || 0) + 12;
          if (inBox || d < bestDist) {
            bestDist = d;
            endNode = node;
          }
        }

        // If it didn't end on a node, create a new Vertex Point at the end
        if (!endNode) {
          endNode = {
            id: MathUtils.uuidv4(),
            x: worldPos.x,
            y: worldPos.y,
            width: 8,
            height: 8,
            type: 'start_end',
            isPoint: true,
          };
          this.props.canvasData.nodes.push(endNode);
        }

        // Create the Comment Line (Edge) connecting Start and End
        if (this.state.edgeStartNode && endNode && this.state.edgeStartNode.id !== endNode.id) {
          const newEdge = {
            id: MathUtils.uuidv4(),
            type: 'comment',
            sourceNode: this.state.edgeStartNode.id,
            targetNode: endNode.id,
          };
          this.props.canvasData.edges.push(newEdge);

          // --- Check for Auto-Promotion to Solid (Tools only) ---
          const src = this.props.canvasData.nodes.find((n) => n.id === newEdge.sourceNode);
          const tgt = this.props.canvasData.nodes.find((n) => n.id === newEdge.targetNode);
          if (src && tgt && !src.isPoint && !tgt.isPoint) {
            newEdge.type = 'solid';
            newEdge.source = src.id;
            newEdge.target = tgt.id;
            delete newEdge.sourceNode;
            delete newEdge.targetNode;
          }
        }

        this.state.isDrawingEdge = false;
        if (this.props.onChange) this.props.onChange();
      } else if (dist < 5) {
        // Single Click -> Create a "Vertex Point" ONLY if clicking empty space
        let alreadyHit = false;
        for (const node of this.props.canvasData.nodes) {
          if (MathUtils.isPointInRect(worldPos.x, worldPos.y, node)) {
            alreadyHit = true;
            break;
          }
        }

        if (!alreadyHit) {
          const newNode = {
            id: MathUtils.uuidv4(),
            x: this.state.penStartPos.x - 4,
            y: this.state.penStartPos.y - 4,
            width: 8,
            height: 8,
            type: 'start_end', // Valid Odoo Type
            label: '',
            isPoint: true,
          };
          this.props.canvasData.nodes.push(newNode);
          if (this.props.onChange) this.props.onChange();
        }
      }
      this.state.penStartPos = null;
    }

    if (this.state.isDrawingEdge) {
      const mx = ev.clientX;
      const my = ev.clientY;
      const worldEnd = this.screenToWorld(mx, my);

      if (!this.props.canvasData.edges) this.props.canvasData.edges = [];

      // Check if we released ON a port
      let hitPortNode = null;
      let hitPort = null;
      for (const node of this.props.canvasData.nodes) {
        for (const port of this.getNodePorts(node)) {
          const sp = this.worldToClientScreen(port.x, port.y);
          if (Math.hypot(mx - sp.x, my - sp.y) <= 12) {
            hitPortNode = node;
            hitPort = port;
            break;
          }
        }
        if (hitPortNode) break;
      }

      const startNode = this.state.edgeStartNode;
      const startPos = this.state.edgeStartPos;

      if (startNode && hitPortNode && hitPortNode.id !== startNode.id) {
        // PORT → PORT: solid real edge
        const exists = this.props.canvasData.edges.some((e) => e.source === startNode.id && e.target === hitPortNode.id);
        if (!exists) {
          this.props.canvasData.edges.push({
            id: MathUtils.uuidv4(),
            type: 'solid',
            source: startNode.id,
            target: hitPortNode.id,
          });
          if (this.props.onChange) this.props.onChange();
        }
      } else {
        // FREE edge: store as comment line with absolute coordinates
        const sx = startPos ? startPos.x : startNode ? startNode.x + startNode.width / 2 : worldEnd.x - 50;
        const sy = startPos ? startPos.y : startNode ? startNode.y + startNode.height / 2 : worldEnd.y - 50;
        const ex = hitPort ? hitPort.x : worldEnd.x;
        const ey = hitPort ? hitPort.y : worldEnd.y;

        // Only save if it has some length
        const dist = Math.hypot(ex - sx, ey - sy);
        if (dist > 10) {
          this.props.canvasData.edges.push({
            id: MathUtils.uuidv4(),
            type: 'comment',
            x1: sx,
            y1: sy,
            x2: ex,
            y2: ey,
          });
          if (this.props.onChange) this.props.onChange();
        }
      }

      this.state.isDrawingEdge = false;
      this.state.edgeStartNode = null;
      this.state.edgeStartPos = null;
      if (this.props.setMode) this.props.setMode('select');
      return;
    }

    if (this.state.isDraggingNode && this.state.activeNode) {
      const draggedNode = this.state.activeNode;
      // Check if dragged node was dropped ON a port of another node → merge (connect)
      let merged = false;
      for (const node of this.props.canvasData.nodes) {
        if (node.id === draggedNode.id) continue;
        for (const port of this.getNodePorts(node)) {
          const sp = this.worldToClientScreen(port.x, port.y);
          if (Math.hypot(ev.clientX - sp.x, ev.clientY - sp.y) <= 16) {
            // Merge: create a solid edge between the two nodes
            const exists = this.props.canvasData.edges.some((e) => e.type === 'solid' && ((e.source === node.id && e.target === draggedNode.id) || (e.source === draggedNode.id && e.target === node.id)));
            if (!exists) {
              this.props.canvasData.edges.push({
                id: MathUtils.uuidv4(),
                type: 'solid',
                source: draggedNode.id,
                target: node.id,
              });
            }
            // Snap dragged node next to the port
            draggedNode.x = port.x - draggedNode.width / 2;
            draggedNode.y = port.y - draggedNode.height / 2;
            merged = true;
            break;
          }
        }
        if (merged) break;
      }

      if (!merged) this.enforceCollision(draggedNode);

      // APPLY MAGNETIC SNAP ON DROP. Boundary snap (a point can't be left
      // floating inside another shape) is a correctness constraint and
      // always applies; grid-rounding is the actual opt-in "Snap"
      // toggle. A stray `|| true` on the outer condition used to force
      // grid-rounding on unconditionally too, so turning "Snap" off in
      // the toolbar never actually did anything.
      const grid = 20;
      this.state.selectedNodes.forEach((nodeId) => {
        const node = this.getNode(nodeId);
        if (node) {
          if (node.isPoint) {
            const snapped = this._snapToBoundaryIfInside({ x: node.x, y: node.y }, nodeId);
            node.x = snapped.x;
            node.y = snapped.y;
          }
          if (this.props.magneticSnap) {
            node.x = Math.round(node.x / grid) * grid;
            node.y = Math.round(node.y / grid) * grid;
          }
        }
      });

      if (this.props.onChange) this.props.onChange();
    }
    this.state.isDraggingCanvas = false;
    this.state.isDraggingNode = false;
    this.state.isMarquee = false;

    // Show floating toolbar if exactly one node/text is selected
    if (this.state.selectedNodes.size === 1 && !this.state.isDraggingNode) {
      const nodeId = Array.from(this.state.selectedNodes)[0];
      const node = this.getNode(nodeId);
      const screenPos = this.worldToScreen(node.x + (node.width || 0) / 2, node.y);
      this.state.showFloatingToolbar = true;
      this.state.floatingToolbarPos = screenPos;
    } else {
      this.state.showFloatingToolbar = false;
    }
  }

  // Double-clicking a shape opens its Properties panel (same as a single
  // select-click) rather than dropping straight into inline text editing -
  // renaming still works fine from the Properties panel's own Label field
  // (user decision 2026-09-09: "double-click should just show Properties,
  // that's it").
  onDblClick(ev) {
    ev.preventDefault();
    const worldPos = this.screenToWorld(ev.clientX, ev.clientY);
    const hitNode = this._findHitNode(worldPos);
    if (hitNode) {
      if (this.props.setActiveNodeId) this.props.setActiveNodeId(hitNode.id);
      this.setHighlightedNodes([hitNode.id]);
      return;
    }
    const hitEdge = this._findHitEdge(worldPos);
    if (hitEdge) {
      if (this.props.setActiveEdgeId) this.props.setActiveEdgeId(hitEdge.id);
    }
  }

  _startInlineEditing(target) {
    const isNode = target.id && !target.source;
    const w = isNode ? target.width : 120;
    const h = isNode ? target.height : 30;
    const x = isNode ? target.x : (target.x1 + target.x2) / 2 - w / 2;
    const y = isNode ? target.y : (target.y1 + target.y2) / 2 - h / 2;

    const sp = this.worldToScreen(x, y);
    const sw = w * this.camera.zoom;
    const sh = h * this.camera.zoom;

    // Final check for coordinate offset
    const rect = this.canvasRef.el.getBoundingClientRect();
    const baseSize = parseInt(target.fontSize || '16');
    const nodeFontSize = baseSize * this.camera.zoom;

    // Same contrast-aware pick _drawNodeLabel() uses to draw the label
    // once committed. This overlay used target.color directly instead -
    // that's the shape's FILL color, not a text color, so on any node
    // with a light fill (the default) the typed text was nearly the same
    // color as the node behind it and looked invisible until Enter
    // handed rendering back to _drawNodeLabel().
    const isCommentTarget = target.isCommentCategory || target.type === 'comment' || target.type === 'text';
    let textColor = target.textColor || (isCommentTarget ? this.settings.comment_font_color : null);
    if (!textColor) {
      textColor = MathUtils.getContrastTextColor(target.color);
    }

    this.state.isEditingText = true;
    this.state.editorValue = target.label || '';
    this.state.editingTarget = target;
    this.state.editorStyle = `
        position: absolute;
        left: 0;
        top: 0;
        transform: translate(${sp.x}px, ${sp.y}px);
        width: ${sw}px;
        height: ${sh}px;
        font-size: ${nodeFontSize}px;
        font-weight: ${target.bold ? 'bold' : 'normal'};
        font-style: ${target.italic ? 'italic' : 'normal'};
        text-align: center;
        resize: none;
        outline: none;
        border: none;
        padding: 0;
        margin: 0;
        background: transparent;
        color: ${textColor};
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        line-height: 1.2;
        box-sizing: border-box;
    `;

    // Position the floating toolbar above the node
    this.state.showFloatingToolbar = true;
    this.state.floatingToolbarPos = {
      x: sp.x + sw / 2,
      y: sp.y - 10, // Adjusted to appear above with translate(-50%, -100%) in CSS
    };

    setTimeout(() => {
      if (this.inlineEditor.el) {
        this.inlineEditor.el.focus();
        this.inlineEditor.el.select();
      }
    }, 50);
  }

  // ─── Long-press shape picker ───────────────────────────────────────
  // Lets you change a node's shape (and toggle Flow/Comment category)
  // in place, instead of deleting and recreating it.
  _openShapePicker(node, mx, my) {
    this.state.isDraggingNode = false;
    this.state.shapePickerNode = node;
    this.state.shapePickerPos = { x: mx, y: my };
  }

  _closeShapePicker() {
    this.state.shapePickerNode = null;
  }

  _setNodeShape(newType) {
    const node = this.state.shapePickerNode;
    if (!node) return;
    node.type = newType;
    // Decision diamonds read better a bit wider/shorter than the other
    // shapes - match the sizing _createNewShape() already uses so a
    // shape swap doesn't leave a diamond squeezed into a rectangle's box.
    if (newType === 'decision') {
      node.width = 110;
      node.height = 70;
    } else if (node.width === 110 && node.height === 70) {
      node.width = 120;
      node.height = 50;
    }
    this._closeShapePicker();
    if (this.props.onChange) this.props.onChange();
  }

  // ─── Auto Layout ────────────────────────────────────────────────────
  // A deliberately basic first version (agreed scope, see chat history):
  // only Flow-category shapes get arranged into ranked layers via BFS
  // from root nodes (no incoming Flow edge); routing points and
  // Comment-category nodes are NOT re-arranged themselves, they just
  // travel by the same delta as whichever Flow shape they're connected
  // to, so a comment stays next to what it's annotating instead of
  // being stranded at its old position or scattered into the grid as if
  // it were a real flow step.
  // Auto-layout algorithm lives in canvas_layout.js as of the 2026-09-10
  // cleanup (pure function over nodes/edges) - this wrapper keeps the
  // component-side effects (clearing selection, firing onChange) here.
  _autoLayout(includeComments = false) {
    layoutFlowDiagram(this.props.canvasData, includeComments);
    this.state.selectedNodes.clear();
    if (this.props.onChange) this.props.onChange();
  }

  deleteSelected() {
    if (!this.props.canvasData) return;
    let changed = false;

    // Delete nodes
    if (this.state.selectedNodes.size > 0) {
      const nodesToDelete = Array.from(this.state.selectedNodes);
      this.props.canvasData.nodes = this.props.canvasData.nodes.filter((n) => !this.state.selectedNodes.has(n.id));

      // Also delete connected edges
      this.props.canvasData.edges = this.props.canvasData.edges.filter((e) => !this.state.selectedNodes.has(e.source) && !this.state.selectedNodes.has(e.target));

      this.state.selectedNodes.clear();
      changed = true;
    }

    // Delete edge
    if (this.state.selectedEdge) {
      this.props.canvasData.edges = this.props.canvasData.edges.filter((e) => e.id !== this.state.selectedEdge);
      this.state.selectedEdge = null;
      changed = true;
    }

    if (changed && this.props.onChange) {
      this.props.onChange();
    }
  }

  onEditorBlur() {
    if (this.state.isEditingText && this.state.editingTarget) {
      this.state.editingTarget.label = this.state.editorValue;
      this.state.isEditingText = false;
      this.state.editingTarget = null;
      if (this.props.onChange) this.props.onChange();
    }
  }

  onEditorKeyDown(ev) {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      this.onEditorBlur();
    } else if (ev.key === 'Escape') {
      this.state.isEditingText = false;
      this.state.editingTarget = null;
    }
  }

  // Distance from point (px,py) to line segment (ax,ay)-(bx,by) in screen space
  _snapToBoundaryIfInside(pos, excludeId = null) {
    for (const node of this.props.canvasData.nodes) {
      if (node.isPoint || node.id === excludeId) continue;

      const margin = 5;
      if (pos.x >= node.x - margin && pos.x <= node.x + node.width + margin && pos.y >= node.y - margin && pos.y <= node.y + node.height + margin) {
        // Point is inside or too close to a tool. Snap to nearest edge.
        const dx1 = Math.abs(pos.x - node.x);
        const dx2 = Math.abs(pos.x - (node.x + node.width));
        const dy1 = Math.abs(pos.y - node.y);
        const dy2 = Math.abs(pos.y - (node.y + node.height));

        const minDist = Math.min(dx1, dx2, dy1, dy2);
        if (minDist === dx1) return { x: node.x, y: pos.y };
        if (minDist === dx2) return { x: node.x + node.width, y: pos.y };
        if (minDist === dy1) return { x: pos.x, y: node.y };
        return { x: pos.x, y: node.y + node.height };
      }
    }
    return pos;
  }

  // Auto-Repel logic
  enforceCollision(targetNode) {
    if (targetNode.isPoint) return; // Points don't collide, they merge!
    const repelForce = 5;
    for (const node of this.props.canvasData.nodes) {
      if (node.id === targetNode.id || node.isPoint) continue;
      if (MathUtils.checkCollision(targetNode, node)) {
        // Determine direction to repel
        const dx = MathUtils.getCenter(targetNode).x - MathUtils.getCenter(node).x;
        const dy = MathUtils.getCenter(targetNode).y - MathUtils.getCenter(node).y;
        if (Math.abs(dx) > Math.abs(dy)) {
          targetNode.x += Math.sign(dx) * repelForce;
        } else {
          targetNode.y += Math.sign(dy) * repelForce;
        }
      }
    }
  }
}
