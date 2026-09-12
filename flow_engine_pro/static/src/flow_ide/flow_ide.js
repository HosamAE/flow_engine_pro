/** @odoo-module **/

import { registry } from '@web/core/registry';
import { Component, useState, onWillStart, onMounted, onWillUnmount, useRef } from '@odoo/owl';
import { useService } from '@web/core/utils/hooks';
import { ConfirmationDialog } from '@web/core/confirmation_dialog/confirmation_dialog';
import { FlowCanvas } from '@flow_engine_pro/components/canvas/canvas';
import { FlowToolbar } from '@flow_engine_pro/components/toolbar/toolbar';
import { computeFlowchartCompliance } from '@flow_engine_pro/core/flowchart_rules';
import { FlowHelpDialog } from '@flow_engine_pro/flow_ide/flow_help_dialog';
import { formatDateTime, deserializeDateTime } from '@web/core/l10n/dates';

export class FlowIDE extends Component {
  static template = 'flow_engine_pro.FlowIDE';
  static components = { FlowCanvas, FlowToolbar };

  setup() {
    this.actionService = useService('action');
    this.orm = useService('orm');
    this.dialogService = useService('dialog');
    this.notificationService = useService('notification');
    this.minimapCanvas = useRef('minimapCanvas');
    this.diagramBgImageInput = useRef('diagramBgImageInput');
    this.importFileInput = useRef('importFileInput');

    // IDE Base State
    this.state = useState({
      mode: 'pan',
      diagramId: this.props.action.context?.active_id || null,
      diagrams: [],
      activeNodeId: null,
      activeEdgeId: null,
      editingDiagramId: null,
      editingDiagramName: '',
      magneticSnap: true,
      canvasData: {
        nodes: [],
        edges: [],
      },
      isDirty: false,
      showExitDialog: false,
      history: [],
      historyIndex: -1,
      camera: { x: 0, y: 0, zoom: 1 },
      showInspector: false,
      // Diagram-level Settings panel (rename / background / info / flowchart
      // compliance) - docks in the exact same slot as the node/edge
      // Properties inspector below, one or the other, never both (user
      // decision 2026-09-09: whichever opens last simply covers the other).
      showDiagramSettings: false,
      lastActiveId: null,
      lastActiveType: null, // 'node' or 'edge'
      selectedDiagramIds: new Set(),
      isBulkMode: false,
      isSidebarPinned: true,
      isSidebarExpanded: true,
      // Merged global + per-diagram display settings (see
      // workflow.diagram.get_effective_settings()), refetched in
      // loadDiagram() - FlowCanvas falls back to its own defaults until
      // this resolves, so it's fine to start empty.
      flowSettings: {},
      // Defaults match get_search_settings()'s own defaults, so nothing
      // flickers hidden before that RPC resolves.
      searchSettings: { enable_sidebar_search: true, enable_header_search: true },
      searchQuery: '',
      sidebarSearchCounts: {}, // diagramId -> match count, for the live per-row badge
      headerSearchQuery: '',
      // Store-review nudge (see _maybeShowReviewPrompt) - a marketing-page
      // callout asking for a review reaches almost nobody at the right
      // moment (people read that page BEFORE installing, not after using
      // it), so this shows once, inside the product itself, after the user
      // has actually saved real work a few times.
      showReviewPrompt: false,
    });

    const handleKeyDown = (ev) => {
      // Do not override if typing in an input
      if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA') return;

      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        this.handleToolbarAction('delete');
      } else if (ev.ctrlKey || ev.metaKey) {
        if (ev.key.toLowerCase() === 'c') {
          this.handleToolbarAction('copy');
        } else if (ev.key.toLowerCase() === 'v') {
          this.handleToolbarAction('paste');
        } else if (ev.key.toLowerCase() === 'x') {
          this.handleToolbarAction('cut');
        } else if (ev.key.toLowerCase() === 'z') {
          if (ev.shiftKey) {
            this.handleToolbarAction('redo');
          } else {
            this.handleToolbarAction('undo');
          }
        } else if (ev.key.toLowerCase() === 'y') {
          this.handleToolbarAction('redo');
        }
      }
    };

    onWillStart(async () => {
      this.orm.call('workflow.diagram', 'get_search_settings', []).then((settings) => {
        this.state.searchSettings = settings;
      });
      await this.loadSidebarDiagrams();

      // Auto-load diagram from URL hash if present
      const hash = window.location.hash;
      const match = hash.match(/[?&]id=(\d+)/);
      const urlId = match ? match[1] : null;

      if (urlId) {
        await this.loadDiagram(parseInt(urlId));
      } else if (this.props.action.context?.active_id) {
        await this.loadDiagram(this.props.action.context.active_id);
      }
    });

    onMounted(() => {
      window.addEventListener('keydown', handleKeyDown);
      // Re-load to ensure fresh state if mounted again
      this.loadSidebarDiagrams();
    });

    onWillUnmount(() => {
      window.removeEventListener('keydown', handleKeyDown);
    });

    this.saveDebounceTimeout = null;
    this._layoutPressTimer = null;
    this._layoutLongPressFired = false;
  }

  pushHistory() {
    if (this.state.historyIndex < this.state.history.length - 1) {
      this.state.history = this.state.history.slice(0, this.state.historyIndex + 1);
    }
    const serialized = JSON.stringify(this.state.canvasData);
    if (this.state.history.length > 0 && this.state.history[this.state.history.length - 1] === serialized) return;

    this.state.history.push(serialized);

    if (this.state.history.length > 50) {
      this.state.history.shift();
    }
    // historyIndex always tracks the index of the entry just pushed
    // (length - 1), not a separately-incremented counter - the old code
    // incremented historyIndex to history.length (one past the last
    // valid index) starting from the very first push, so undo's
    // `history[--historyIndex]` read back the entry that had just been
    // written instead of the one before it and was a silent no-op. See
    // chat history 2026-09-04 for the live repro (dragged a node,
    // clicked Undo, position never changed).
    this.state.historyIndex = this.state.history.length - 1;
  }

  toggleMagneticSnap() {
    this.state.magneticSnap = !this.state.magneticSnap;
  }

  // Layout button: a short click auto-arranges Flow shapes only; holding
  // it down also places Comment nodes deliberately next to whichever
  // Flow shape they annotate. This button is plain HTML (not part of
  // the canvas), so it needs its own mousedown/mouseup timer instead of
  // reusing the canvas's own long-press mechanism.
  onLayoutMouseDown() {
    this._layoutLongPressFired = false;
    if (this._layoutPressTimer) clearTimeout(this._layoutPressTimer);
    this._layoutPressTimer = setTimeout(() => {
      this._layoutLongPressFired = true;
      window.dispatchEvent(new CustomEvent('flow_action', { detail: { action: 'auto_layout_with_comments' } }));
    }, this.state.flowSettings.longpress_duration_ms || 550);
  }

  onLayoutMouseUp() {
    if (this._layoutPressTimer) {
      clearTimeout(this._layoutPressTimer);
      this._layoutPressTimer = null;
    }
    if (!this._layoutLongPressFired) {
      this.handleToolbarAction('auto_layout');
    }
  }

  onLayoutMouseLeave() {
    if (this._layoutPressTimer) {
      clearTimeout(this._layoutPressTimer);
      this._layoutPressTimer = null;
    }
  }


  async handleToolbarAction(action) {
    if (action === 'undo') {
      if (this.state.historyIndex > 0) {
        this.state.historyIndex--;
        // Reactive deep clone update
        this.state.canvasData = Object.assign(this.state.canvasData, JSON.parse(this.state.history[this.state.historyIndex]));
        this.updateDirtyState();
      }
      return;
    } else if (action === 'redo') {
      if (this.state.historyIndex < this.state.history.length - 1) {
        this.state.historyIndex++;
        this.state.canvasData = Object.assign(this.state.canvasData, JSON.parse(this.state.history[this.state.historyIndex]));
        this.updateDirtyState();
      }
      return;
    } else if (action === 'save') {
      await this.saveCanvasData();
      return;
    } else if (action === 'discard') {
      if (this.state.isDirty) {
        const confirmed = window.confirm("You have unsaved changes. \n\n- Click 'OK' to Save and Exit\n- Click 'Cancel' to Discard these changes and Exit");
        if (confirmed) {
          await this.saveCanvasData();
        } else {
          localStorage.removeItem(`flow_cache_${this.state.diagramId}`);
        }
      } else {
        // CLEAN EXIT: No prompt, just remove cache and close
        localStorage.removeItem(`flow_cache_${this.state.diagramId}`);
      }
      // Close the workshop
      this.state.diagramId = null;
      this.state.diagramName = null;
      this.state.activeNodeId = null;
      this.state.isDirty = false;
      this.initialData = null;
      return;
    }
    window.dispatchEvent(new CustomEvent('flow_action', { detail: { action: action } }));
  }

  updateDirtyState() {
    const currentDataStr = JSON.stringify({
      nodes: this.state.canvasData.nodes,
      edges: this.state.canvasData.edges,
      backgroundImage: this.state.canvasData.backgroundImage || null,
    });
    this.state.isDirty = currentDataStr !== this.initialData;
  }

  async saveCanvasData() {
    if (!this.state.diagramId) return;
    const dataStr = JSON.stringify({
      nodes: this.state.canvasData.nodes,
      edges: this.state.canvasData.edges,
      backgroundImage: this.state.canvasData.backgroundImage || null,
    });
    try {
      await this.orm.write('workflow.diagram', [this.state.diagramId], { canvas_data: dataStr });
      this.initialData = dataStr; // Sync initial state
      this.state.isDirty = false;
      localStorage.removeItem(`flow_cache_${this.state.diagramId}`);
      // "End of workshop" auto-snapshot - every save (manual Save, Save &
      // Close, or the confirm-and-save branch of Discard) also refreshes
      // the diagram's one internal thumbnail, not just the explicit
      // Capture button.
      if (this._canvasApi) this.saveSnapshot(this._canvasApi.captureSnapshotDataUrl());
      this._maybeShowReviewPrompt();
    } catch (e) {
      console.error('Failed to save:', e);
    }
  }

  // Shows a small, dismissible nudge to rate the app on the Odoo Apps
  // Store, once, after the 3rd successful save in this browser - a save
  // means they actually built something real, not just opened the app
  // once. Silent forever after either a real dismiss or after it's shown
  // once, so this can never nag.
  _maybeShowReviewPrompt() {
    const DISMISSED_KEY = 'flow_engine_pro_review_dismissed';
    const COUNT_KEY = 'flow_engine_pro_review_save_count';
    const THRESHOLD = 3;
    try {
      if (localStorage.getItem(DISMISSED_KEY)) return;
      const count = parseInt(localStorage.getItem(COUNT_KEY) || '0', 10) + 1;
      localStorage.setItem(COUNT_KEY, String(count));
      if (count === THRESHOLD) {
        this.state.showReviewPrompt = true;
      }
    } catch (e) {
      // localStorage unavailable (private browsing, etc.) - just skip.
    }
  }

  dismissReviewPrompt() {
    this.state.showReviewPrompt = false;
    try {
      localStorage.setItem('flow_engine_pro_review_dismissed', '1');
    } catch (e) { /* ignore */ }
  }

  openReviewPage() {
    window.open('https://apps.odoo.com/apps/modules/18.0/flow_engine_pro#comment', '_blank', 'noopener,noreferrer');
    this.dismissReviewPrompt();
  }

  // Persists a PNG data URL (from FlowCanvas's onSaveSnapshot prop, or
  // the auto-snapshot above) as the diagram's single internal thumbnail
  // attachment - see workflow.diagram.save_snapshot() on the backend.
  saveSnapshot(dataUrl) {
    if (!this.state.diagramId || !dataUrl) return;
    const base64 = dataUrl.split(',')[1];
    this.orm.call('workflow.diagram', 'save_snapshot', [[this.state.diagramId], base64]).catch((e) => {
      console.error('Failed to save snapshot:', e);
    });
  }

  handleClose() {
    if (this.state.isDirty) {
      this.state.showExitDialog = true;
    } else {
      this.state.diagramId = null;
      this.state.diagramName = '';
    }
  }

  discardAndClose() {
    this.state.showExitDialog = false;
    this.state.isDirty = false;
    this.state.diagramId = null;
    this.state.diagramName = '';
  }

  async saveAndClose() {
    await this.saveCanvasData();
    this.state.showExitDialog = false;
    this.state.diagramId = null;
    this.state.diagramName = '';
  }

  onCanvasChange() {
    if (!this.state.diagramId) return;

    this.updateDirtyState();
    this.pushHistory();

    // Sync with LocalStorage
    const dataStr = JSON.stringify({
      nodes: this.state.canvasData.nodes,
      edges: this.state.canvasData.edges,
      backgroundImage: this.state.canvasData.backgroundImage || null,
    });
    localStorage.setItem(`flow_cache_${this.state.diagramId}`, dataStr);

    // Background autosave to the server (debounced 800ms). This function
    // was already fully built but never wired up, so until now the only
    // way changes actually reached the database was the explicit Save
    // button/shortcut - closing the tab without pressing it lost the
    // work on the server (only the local cache above had it, and that
    // was never read back either - see loadDiagram()).
    this.saveToDatabase();

    this.drawMinimap();
  }

  updateActiveItemProperty(prop, value) {
    const activeItem = this.state.activeNodeId ? this.state.canvasData.nodes.find((n) => n.id === this.state.activeNodeId) : this.state.activeEdgeId ? this.state.canvasData.edges.find((e) => e.id === this.state.activeEdgeId) : null;

    if (activeItem) {
      activeItem[prop] = value;
      this.onCanvasChange();
    }
  }

  // Reads the picked file as a data URL and stores it directly on the
  // node (like every other node property, inside canvas_data's JSON) -
  // no separate ir.attachment plumbing needed since the whole diagram is
  // already one JSON blob.
  onNodeBgImageChange(ev) {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => this.updateActiveItemProperty('bgImage', reader.result);
    reader.readAsDataURL(file);
  }

  // Whole-canvas background image - stored as a third top-level key
  // alongside nodes/edges in canvas_data's JSON (see loadDiagram() and
  // saveCanvasData(), both of which now read/write it too).
  //
  // Lives on the diagram record's own "..." menu in the sidebar, not the
  // workspace toolbar (user feedback 2026-09-07: it's a property of the
  // record, like Rename, not a canvas tool) - and works whether or not
  // that diagram is the one currently open, since the sidebar lists every
  // diagram at once. One shared hidden <input> (see the template) is
  // reused for every row; which diagram it's for is tracked here.
  openDiagramBgImagePicker(diagramId) {
    this._pendingBgImageDiagramId = diagramId;
    this.diagramBgImageInput.el.click();
  }

  onDiagramBgImageChange(ev) {
    const file = ev.target.files && ev.target.files[0];
    const diagramId = this._pendingBgImageDiagramId;
    ev.target.value = ''; // so picking the same file again next time still fires 'change'
    if (!file || !diagramId) return;
    const reader = new FileReader();
    reader.onload = () => this._writeDiagramBgImage(diagramId, reader.result);
    reader.readAsDataURL(file);
  }

  clearDiagramBgImage(diagramId) {
    this._writeDiagramBgImage(diagramId, null);
  }

  // If `diagramId` is the one currently open in the editor, updates the
  // live state directly (onCanvasChange() then handles persisting it
  // through the normal save/autosave path). Otherwise it isn't loaded
  // into memory at all, so this reads that diagram's canvas_data,
  // patches just the backgroundImage key, and writes it straight back.
  async _writeDiagramBgImage(diagramId, dataUrl) {
    if (diagramId === this.state.diagramId) {
      this.state.canvasData.backgroundImage = dataUrl;
      this.onCanvasChange();
      return;
    }
    const records = await this.orm.read('workflow.diagram', [diagramId], ['canvas_data']);
    let data = { nodes: [], edges: [] };
    try {
      data = JSON.parse((records[0] && records[0].canvas_data) || '{}');
    } catch (e) {
      // Malformed canvas_data - safest to leave nodes/edges empty rather
      // than crash the write; the background image is still worth saving.
    }
    data.backgroundImage = dataUrl;
    await this.orm.write('workflow.diagram', [diagramId], { canvas_data: JSON.stringify(data) });
  }

  closeInspector() {
    this.state.activeNodeId = null;
    this.state.activeEdgeId = null;
  }

  onTransformChange(camera) {
    this.state.camera = camera;
    this.drawMinimap();
  }

  // Handed by FlowCanvas on mount (see canvas.js's registerApi prop) -
  // an Owl t-ref on a sub-component only exposes its DOM node, not the
  // instance, so this is how the Navigator minimap reaches the camera.
  registerCanvasApi(api) {
    this._canvasApi = api;
  }

  onMinimapMouseDown(ev) {
    this._minimapDragging = true;
    this._minimapJumpTo(ev);
  }

  onMinimapMouseMove(ev) {
    if (!this._minimapDragging) return;
    this._minimapJumpTo(ev);
  }

  onMinimapMouseUp() {
    this._minimapDragging = false;
  }

  // Converts a click/drag position on the minimap canvas back into a
  // world coordinate (inverse of the scale+translate drawMinimap() used)
  // and asks FlowCanvas to recenter its camera there.
  _minimapJumpTo(ev) {
    const t = this._minimapTransform;
    const canvas = this.minimapCanvas.el;
    if (!t || !canvas || !this._canvasApi) return;
    const rect = canvas.getBoundingClientRect();
    const px = (ev.clientX - rect.left) * (canvas.width / rect.width);
    const py = (ev.clientY - rect.top) * (canvas.height / rect.height);
    const wx = px / t.scale + t.minX - t.padding;
    const wy = py / t.scale + t.minY - t.padding;
    this._canvasApi.centerOn(wx, wy);
  }

  drawMinimap() {
    const canvas = this.minimapCanvas.el;
    if (!canvas) return;

    // Match internal resolution to display size
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const ctx = canvas.getContext('2d');
    const nodes = this.state.canvasData.nodes;
    const edges = this.state.canvasData.edges;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!nodes.length) return;

    // Find diagram bounds
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    nodes.forEach((n) => {
      const w = n.width || (n.isPoint ? 0 : 100);
      const h = n.height || (n.isPoint ? 0 : 50);
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + w);
      maxY = Math.max(maxY, n.y + h);
    });

    const padding = 100;
    const worldW = maxX - minX + padding * 2;
    const worldH = maxY - minY + padding * 2;
    const scale = Math.min(canvas.width / worldW, canvas.height / worldH);

    // Remembered so onMinimapMouseDown/Move can invert a click back to a
    // world coordinate using the exact same transform just drawn with.
    this._minimapTransform = { minX, minY, padding, scale };

    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(-minX + padding, -minY + padding);

    // 1. Draw Edges
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 3;
    edges.forEach((e) => {
      const s = nodes.find((n) => n.id === (e.sourceNode || e.source));
      const t = nodes.find((n) => n.id === (e.targetNode || e.target));
      if (s && t) {
        ctx.beginPath();
        ctx.moveTo(s.x + (s.width || 0) / 2, s.y + (s.height || 0) / 2);
        ctx.lineTo(t.x + (t.width || 0) / 2, t.y + (t.height || 0) / 2);
        ctx.stroke();
      }
    });

    // 2. Draw Nodes
    nodes.forEach((n) => {
      ctx.fillStyle = n.color || 'rgba(13, 110, 253, 0.7)';
      if (n.isPoint) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, 8, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(n.x, n.y, n.width || 100, n.height || 50);
      }
    });

    // 3. Draw Viewport (Current Camera View)
    const cam = this.state.camera;
    const viewW = rect.width / cam.zoom;
    const viewH = rect.height / cam.zoom;
    const viewX = -cam.x / cam.zoom;
    const viewY = -cam.y / cam.zoom;

    ctx.strokeStyle = '#ff4757';
    ctx.lineWidth = 4;
    ctx.setLineDash([10, 10]);
    ctx.strokeRect(viewX, viewY, viewW, viewH);

    ctx.restore();
  }

  onDiagramChange() {
    this.onCanvasChange();
  }

  // Debounced background autosave to the server, called from
  // onCanvasChange(). Delegates to saveCanvasData() rather than writing
  // directly so the dirty flag, initialData snapshot and local cache stay
  // consistent whether the save was triggered automatically or by the
  // explicit Save button.
  saveToDatabase() {
    if (!this.state.diagramId) return;
    if (this.saveDebounceTimeout) {
      clearTimeout(this.saveDebounceTimeout);
    }
    this.saveDebounceTimeout = setTimeout(() => {
      this.saveCanvasData();
    }, 800);
  }

  setMode(newMode) {
    this.state.mode = newMode;
  }

  setActiveNodeId(id) {
    this.state.activeNodeId = id;
    if (id) {
      this.state.activeEdgeId = null;
      this.state.lastActiveId = id;
      this.state.lastActiveType = 'node';
      this.state.showInspector = true; // Auto-open
      this.state.showDiagramSettings = false; // Properties wins the shared slot
    }
  }

  setActiveEdgeId(id) {
    this.state.activeEdgeId = id;
    if (id) {
      this.state.activeNodeId = null;
      this.state.lastActiveId = id;
      this.state.lastActiveType = 'edge';
      this.state.showInspector = true; // Auto-open
      this.state.showDiagramSettings = false; // Properties wins the shared slot
    }
  }

  // Toggles the diagram-level Settings panel (rename / background / info /
  // flowchart compliance). Opening it deselects any active node/edge so it
  // takes over the shared right-dock slot from the Properties inspector.
  toggleDiagramSettings() {
    this.state.showDiagramSettings = !this.state.showDiagramSettings;
    if (this.state.showDiagramSettings) {
      this.state.activeNodeId = null;
      this.state.activeEdgeId = null;
      this.renameDiagram(this.state.diagramId, this.state.diagramName);
    } else {
      this.cancelRename();
    }
  }

  get flowchartCompliance() {
    return computeFlowchartCompliance(this.state.canvasData);
  }

  // Everything worth knowing about the open diagram at a glance, for the
  // Diagram Settings panel's Info section (user request 2026-09-09: "put
  // every possible piece of information in there").
  get diagramInfo() {
    const nodes = this.state.canvasData.nodes || [];
    const edges = this.state.canvasData.edges || [];
    const isText = (n) => n.type === 'text';
    const isComment = (n) => !isText(n) && (n.isCommentCategory || n.type === 'comment' || ['triangle', 'pentagon', 'hexagon', 'star', 'trapezoid'].includes(n.type));
    const countType = (t) => nodes.filter((n) => n.type === t && !isComment(n) && !isText(n)).length;
    const fmtDate = (v) => {
      if (!v) return '-';
      try {
        return formatDateTime(deserializeDateTime(v));
      } catch {
        return v;
      }
    };
    return {
      startEndCount: countType('start_end'),
      decisionCount: countType('decision'),
      processCount: countType('process'),
      dataCount: countType('data'),
      commentCount: nodes.filter(isComment).length,
      textCount: nodes.filter(isText).length,
      connectionCount: edges.length,
      hasBackgroundImage: !!this.state.canvasData.backgroundImage,
      createdLabel: fmtDate(this.state.diagramCreateDate),
      updatedLabel: fmtDate(this.state.diagramWriteDate),
    };
  }

  openHelp() {
    this.dialogService.add(FlowHelpDialog, {});
  }

  toggleInspector() {
    this.state.showInspector = !this.state.showInspector;
  }

  // ─── Zoom Controls (called from Footer toolbar) ───────────────────────────
  zoomIn() {
    window.dispatchEvent(new CustomEvent('flow_action', { detail: { action: 'zoom_in' } }));
  }

  zoomOut() {
    window.dispatchEvent(new CustomEvent('flow_action', { detail: { action: 'zoom_out' } }));
  }

  resetZoom() {
    window.dispatchEvent(new CustomEvent('flow_action', { detail: { action: 'reset_view' } }));
  }

  // Finds a shape by name across every diagram (not just the open one -
  // workflow.node is the SQL search index kept in sync on every save),
  // opens its diagram if it isn't already open, then pans + pulses it.
  // Live (debounced) per-row match counts for the sidebar search, so you
  // can see which diagrams even contain a match before jumping to one
  // (user request 2026-09-10). Separate from searchAndPulse(), which only
  // fires on Enter.
  onSidebarSearchInput() {
    clearTimeout(this._sidebarSearchDebounce);
    this._sidebarSearchDebounce = setTimeout(() => this._computeSidebarSearchCounts(), 250);
  }

  async _computeSidebarSearchCounts() {
    const query = (this.state.searchQuery || '').trim();
    if (!query) {
      this.state.sidebarSearchCounts = {};
      return;
    }
    // Odoo 18's orm.webReadGroup signature is (model, domain, fields,
    // groupby) - fields/groupby swapped from Odoo 19's (model, domain,
    // groupby, aggregates). Also, the per-group record count comes back
    // under '<groupby_field>_count' (e.g. diagram_id_count) in 18, not
    // the uniform '__count' key Odoo 19 introduced. Found while porting
    // from the 19.0 branch.
    const result = await this.orm.webReadGroup('workflow.node', [['name', 'ilike', query]], ['__count'], ['diagram_id']);
    const counts = {};
    for (const g of result.groups || []) {
      const diagramId = g.diagram_id && g.diagram_id[0];
      if (diagramId) counts[diagramId] = g.diagram_id_count;
    }
    this.state.sidebarSearchCounts = counts;
  }

  // Diagram-scoped search (header): purely client-side, filters the
  // ALREADY-LOADED canvas data of the open diagram and highlights every
  // match at once instead of jumping to one (user request 2026-09-10).
  onHeaderSearchInput() {
    const query = (this.state.headerSearchQuery || '').trim().toLowerCase();
    if (!this._canvasApi) return;
    if (!query) {
      this._canvasApi.setHighlightedNodes([]);
      return;
    }
    const matches = (this.state.canvasData.nodes || []).filter(
      (n) => (n.label || '').toLowerCase().includes(query)
    );
    this._canvasApi.setHighlightedNodes(matches.map((n) => n.id));
  }

  // Pin/unpin the currently active shape's highlight so it stays lit
  // even after it's deselected, until toggled off again (user request
  // 2026-09-10) - kept independent of the transient double-click
  // highlight, in its own set inside canvas.js.
  toggleStickyHighlight() {
    if (!this._canvasApi || !this.state.activeNodeId) return;
    this._canvasApi.toggleStickyHighlight(this.state.activeNodeId);
  }

  get isActiveNodeStickyHighlighted() {
    if (!this._canvasApi || !this.state.activeNodeId) return false;
    return this._canvasApi.isNodeStickyHighlighted(this.state.activeNodeId);
  }

  async searchAndPulse() {
    const query = (this.state.searchQuery || '').trim();
    if (!query) return;
    const matches = await this.orm.searchRead(
      'workflow.node',
      [['name', 'ilike', query]],
      ['node_uuid', 'diagram_id', 'name'],
      { limit: 1 }
    );
    if (!matches.length) {
      this.notificationService.add(`No shape found matching "${query}"`, { type: 'warning' });
      return;
    }
    const match = matches[0];
    const targetDiagramId = match.diagram_id[0];
    if (this.state.diagramId !== targetDiagramId) {
      await this.loadDiagram(targetDiagramId);
    }
    // Runs after loadDiagram's own post-load fitToContent (scheduled at
    // setTimeout(0)) so this specific pulse+center wins as the last word.
    setTimeout(() => {
      if (this._canvasApi) this._canvasApi.pulseNode(match.node_uuid);
    }, 150);
  }

  async loadSidebarDiagrams() {
    // Fetch all diagrams for the sidebar with sequence order
    const diagrams = await this.orm.searchRead('workflow.diagram', [], ['id', 'name', 'sequence'], {
      order: 'sequence asc, id asc',
    });
    this.state.diagrams = diagrams;
  }

  async loadDiagram(diagramId) {
    this.state.diagramId = diagramId;
    this.state.activeNodeId = null;
    // The header search is scoped to whichever diagram is open - a stale
    // query/highlight from the previous one shouldn't carry over.
    this.state.headerSearchQuery = '';
    if (this._canvasApi) this._canvasApi.setHighlightedNodes([]);
    this.orm.call('workflow.diagram', 'get_effective_settings', [[diagramId]]).then((settings) => {
      this.state.flowSettings = settings;
    });
    const result = await this.orm.read('workflow.diagram', [diagramId], ['name', 'canvas_data', 'create_date', 'write_date']);
    if (result && result.length) {
      this.state.diagramName = result[0].name;
      this.state.diagramCreateDate = result[0].create_date;
      this.state.diagramWriteDate = result[0].write_date;

      const serverData = result[0].canvas_data;
      const cached = localStorage.getItem(`flow_cache_${diagramId}`);
      // Recover unsaved local work if present. This cache is written on
      // every change (see onCanvasChange) precisely so a crashed tab or a
      // window closed without pressing Save isn't silently lost - it was
      // previously written but never read back here, so recovery never
      // actually happened despite the cache existing.
      const usingCache = !!(cached && cached !== serverData);
      const rawData = usingCache ? cached : serverData;

      try {
        const parsedServer = JSON.parse(serverData || '{"nodes":[],"edges":[]}');
        const parsed = usingCache ? JSON.parse(rawData) : parsedServer;
        this.state.canvasData = {
          nodes: parsed.nodes || [],
          edges: parsed.edges || [],
          backgroundImage: parsed.backgroundImage || null,
        };
        // Dirty tracking always compares against the SERVER copy, so a
        // recovered draft correctly shows as unsaved until the user
        // explicitly saves it (or discards it, which clears the cache).
        this.initialData = JSON.stringify({
          nodes: parsedServer.nodes || [],
          edges: parsedServer.edges || [],
          backgroundImage: parsedServer.backgroundImage || null,
        });
        this.state.isDirty = usingCache;
      } catch (e) {
        this.state.canvasData = { nodes: [], edges: [], backgroundImage: null };
      }
      // Seed history with the freshly-loaded state as the undo baseline,
      // paired with historyIndex - previously historyIndex was reset to 0
      // while history itself stayed [] (leftover from useState's initial
      // value or a prior diagram), an inconsistent pair on top of the
      // pushHistory() off-by-one fixed above.
      this.state.history = [JSON.stringify(this.state.canvasData)];
      this.state.historyIndex = 0;

      // FlowCanvas already fits-to-content on its OWN first mount, but
      // switching between diagrams while it stays mounted (the sidebar
      // click path) needs this explicit nudge too. Deferred one tick so
      // Owl has actually re-rendered FlowCanvas with the new canvasData
      // prop first - calling this synchronously would still read the
      // PREVIOUS diagram's nodes and fit to the wrong bounding box.
      setTimeout(() => {
        if (this._canvasApi) this._canvasApi.fitToContent();
      }, 0);

      // Update URL hash to include the record ID (Native JS way).
      // The unanchored /id=\d+/ this used to use matched the TAIL of
      // 'menu_id=' or 'cids=' (both legitimately contain the substring
      // 'id=') whenever no diagram had been opened yet in this hash,
      // silently corrupting menu_id into the diagram's own id and
      // hijacking the whole app to an unrelated menu. Odoo 18's
      // pretty-URL routing (/odoo/...) doesn't populate the hash this
      // way in normal use, so this stayed dormant here, but it's a real
      // bug on any hash-based route - found live on the 17.0 port, where
      // the classic #action=..&cids=..&menu_id=.. hash format exposed it
      // immediately (backported here for correctness). Now only matches
      // a standalone id= param (preceded by & or #).
      const currentHash = window.location.hash;
      if (/[&#]id=\d+/.test(currentHash)) {
        window.location.hash = currentHash.replace(/([&#])id=\d+/, `$1id=${diagramId}`);
      } else {
        window.location.hash = currentHash + `&id=${diagramId}`;
      }
    }
  }

  async createNewDiagram() {
    const diagramId = await this.orm.create('workflow.diagram', [
      {
        name: 'New Workflow Outline',
        canvas_data: '{"nodes":[],"edges":[]}',
      },
    ]);
    this.state.activeNodeId = null;
    await this.loadSidebarDiagrams();
    await this.loadDiagram(diagramId[0]);

    // Auto trigger rename on create
    this.renameDiagram(diagramId[0], 'New Workflow Outline');
  }

  async duplicateDiagram(diagramId) {
    const original = this.state.diagrams.find((d) => d.id === diagramId);
    if (!original) return;

    let canvasData = '{"nodes":[],"edges":[]}';
    const result = await this.orm.read('workflow.diagram', [diagramId], ['canvas_data']);
    if (result && result.length) {
      canvasData = result[0].canvas_data;
    }

    const newName = original.name + ' (Copy)';
    const newId = await this.orm.create('workflow.diagram', [
      {
        name: newName,
        canvas_data: canvasData,
      },
    ]);
    await this.loadSidebarDiagrams();
    await this.loadDiagram(newId[0]);

    // Auto trigger rename on duplicate
    this.renameDiagram(newId[0], newName);
  }

  renameDiagram(diagramId, currentName) {
    this.state.editingDiagramId = diagramId;
    this.state.editingDiagramName = currentName;
  }

  cancelRename() {
    this.state.editingDiagramId = null;
  }

  async saveDiagramName(diagramId) {
    if (this.state.editingDiagramId !== diagramId) return;
    const newName = this.state.editingDiagramName.trim();
    if (newName && newName !== '') {
      await this.orm.write('workflow.diagram', [diagramId], { name: newName });
      await this.loadSidebarDiagrams();
      if (this.state.diagramId === diagramId) {
        this.state.diagramName = newName; // keep the open header title in sync
      }
    }
    this.state.editingDiagramId = null;
  }

  deleteDiagram(diagramId) {
    this.dialogService.add(ConfirmationDialog, {
      body: 'Are you sure you want to delete this diagram? This action cannot be undone.',
      confirmLabel: 'Delete',
      confirm: async () => {
        await this.orm.unlink('workflow.diagram', [diagramId]);
        await this.loadSidebarDiagrams();
        if (this.state.diagramId === diagramId) {
          this.state.diagramId = null;
          if (this.state.diagrams.length > 0) {
            await this.loadDiagram(this.state.diagrams[0].id);
          }
        }
      },
      cancel: () => {},
    });
  }

  async deleteSelectedDiagrams() {
    const ids = Array.from(this.state.selectedDiagramIds);
    if (ids.length === 0) return;
    this.dialogService.add(ConfirmationDialog, {
      body: `Are you sure you want to delete ${ids.length} selected diagrams?`,
      confirmLabel: 'Delete Selected',
      confirm: async () => {
        await this.orm.unlink('workflow.diagram', ids);
        this.state.selectedDiagramIds.clear();
        this.state.isBulkMode = false;
        await this.loadSidebarDiagrams();
        if (ids.includes(this.state.diagramId)) {
          this.state.diagramId = null;
          if (this.state.diagrams.length > 0) {
            await this.loadDiagram(this.state.diagrams[0].id);
          }
        }
      },
      cancel: () => {},
    });
  }

  onDiagramDragStart(ev, diagramId) {
    ev.dataTransfer.setData('diagramId', diagramId);
    ev.dataTransfer.effectAllowed = 'move';
  }

  async onDiagramDrop(ev, targetId) {
    const sourceId = parseInt(ev.dataTransfer.getData('diagramId'));
    if (sourceId === targetId) return;

    const diagrams = [...this.state.diagrams];
    const sourceIdx = diagrams.findIndex((d) => d.id === sourceId);
    const targetIdx = diagrams.findIndex((d) => d.id === targetId);

    if (sourceIdx > -1 && targetIdx > -1) {
      const [moved] = diagrams.splice(sourceIdx, 1);
      diagrams.splice(targetIdx, 0, moved);

      // Update sequences in DB
      const updates = diagrams.map((d, index) => {
        return this.orm.write('workflow.diagram', [d.id], { sequence: index * 10 });
      });
      await Promise.all(updates);
      await this.loadSidebarDiagrams();
    }
  }

  toggleDiagramSelection(diagramId) {
    if (this.state.selectedDiagramIds.has(diagramId)) {
      this.state.selectedDiagramIds.delete(diagramId);
    } else {
      this.state.selectedDiagramIds.add(diagramId);
    }
  }

  // --- Smart Sidebar Logic ---
  toggleSidebarPin() {
    this.state.isSidebarPinned = !this.state.isSidebarPinned;
    this.state.isSidebarExpanded = this.state.isSidebarPinned;
  }

  onSidebarMouseEnter() {
    if (!this.state.isSidebarPinned) {
      this.state.isSidebarExpanded = true;
    }
  }

  onSidebarMouseLeave() {
    if (!this.state.isSidebarPinned) {
      this.state.isSidebarExpanded = false;
    }
  }

  // Triggers the file picker backing the Import button - the actual
  // reading happens in onImportFileChange() once a file is picked.
  importDiagrams() {
    if (this.importFileInput && this.importFileInput.el) this.importFileInput.el.click();
  }

  async onImportFileChange(ev) {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const items = Array.isArray(payload) ? payload : payload.diagrams || [];
      if (!items.length) throw new Error('No diagrams found in file');
      const valsList = items.map((d) => ({
        name: d.name ? `${d.name} (Imported)` : 'Imported Diagram',
        canvas_data: typeof d.canvas_data === 'string' ? d.canvas_data : JSON.stringify(d.canvas_data || { nodes: [], edges: [] }),
      }));
      await this.orm.create('workflow.diagram', valsList);
      await this.loadSidebarDiagrams();
      this.notificationService?.add(`Imported ${valsList.length} diagram(s).`, { type: 'success' });
    } catch (e) {
      console.error('Import failed:', e);
      this.dialogService.add(ConfirmationDialog, {
        title: 'Import Failed',
        body: `Could not read this file as a Flow Engine export: ${e.message}`,
        confirmLabel: 'OK',
        confirm: () => {},
        cancel: () => {},
      });
    } finally {
      ev.target.value = '';
    }
  }

  async exportDiagrams() {
    const ids = Array.from(this.state.selectedDiagramIds);
    if (!ids.length) return;
    const records = await this.orm.read('workflow.diagram', ids, ['name', 'canvas_data']);
    const payload = {
      exported_from: 'flow_engine_pro',
      exported_at: new Date().toISOString(),
      diagrams: records.map((r) => ({ name: r.name, canvas_data: r.canvas_data })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `flow_diagrams_export_${new Date().getTime()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

registry.category('actions').add('flow_engine_pro.action_ide', FlowIDE);
