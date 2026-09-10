/** @odoo-module **/

export const MathUtils = {
  // Generate UUID
  uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0,
        v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  },

  // Bounding Box Collision
  checkCollision(rect1, rect2) {
    return rect1.x < rect2.x + (rect2.width || 0) && rect1.x + (rect1.width || 0) > rect2.x && rect1.y < rect2.y + (rect2.height || 0) && rect1.height + rect1.y > rect2.y;
  },

  // Point in rect
  isPointInRect(pt, rect) {
    return pt.x >= rect.x && pt.x <= rect.x + (rect.width || 0) && pt.y >= rect.y && pt.y <= rect.y + (rect.height || 0);
  },

  // Center point logic
  getCenter(rect) {
    return {
      x: rect.x + (rect.width || 0) / 2,
      y: rect.y + (rect.height || 0) / 2,
    };
  },

  /**
   * Finds the intersection point of a line segment (p1, p2) with a rectangle's boundary.
   * p2 is assumed to be inside or the center of the rect.
   */
  getBoundaryIntersection(pOutside, pCenter, node) {
    const x1 = pOutside.x,
      y1 = pOutside.y;
    const x2 = pCenter.x,
      y2 = pCenter.y;
    const w = node.width || 120,
      h = node.height || 80;
    const cx = node.x + w / 2,
      cy = node.y + h / 2;

    const dx = x1 - cx;
    const dy = y1 - cy;

    // 1. ELLIPSE (Start/End/Oval)
    if (node.type === 'oval' || node.type === 'start_end' || node.type === 'start' || node.type === 'end' || node.type === 'process_oval') {
      const a = w / 2,
        b = h / 2;
      if (dx === 0 && dy === 0) return { x: cx, y: cy };
      const angle = Math.atan2(dy, dx);
      const r = (a * b) / Math.sqrt(Math.pow(b * Math.cos(angle), 2) + Math.pow(a * Math.sin(angle), 2));
      return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    }

    // 2. DIAMOND (Decision)
    if (node.type === 'diamond' || node.type === 'decision') {
      const a = w / 2,
        b = h / 2;
      const dist = Math.abs(dx / a) + Math.abs(dy / b);
      if (dist === 0) return { x: cx, y: cy };
      return { x: cx + dx / dist, y: cy + dy / dist };
    }

    // 3. PARALLELOGRAM (Data)
    if (node.type === 'parallelogram' || node.type === 'data') {
      const offset = Math.min(w * 0.2, 15);
      // Treat as a polygon intersection or simplified box for now
      // For brevity, we'll use a slightly adjusted box intersection
    }

    // 4. RECTANGLE (Process/Comment/Default)
    const halfW = w / 2,
      halfH = h / 2;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    const scale = Math.min(Math.abs(halfW / dx), Math.abs(halfH / dy));
    return { x: cx + dx * scale, y: cy + dy * scale };
  },

  // Draw Primitives
  //
  // `border` (all shape-draw functions below) carries the Settings-driven
  // look of the shape's own outline - { width, dash, enabled } - falling
  // back to the old hardcoded 1px solid stroke when omitted so callers
  // that don't care (tests, the settings-preview swatch with its own
  // explicit values, etc.) keep working unchanged. `enabled: false` skips
  // the stroke entirely UNLESS the shape is selected, so a selected shape
  // is still visibly outlined even with borders turned off in Settings.
  drawRect(ctx, x, y, width, height, isSelected, color = '#bae1ff', stroke = '#205493', border = {}) {
    const { width: bw = 1, dash = [], enabled = true } = border;
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = isSelected ? '#0d6efd' : stroke;
    ctx.lineWidth = isSelected ? 2 : bw;
    ctx.setLineDash(isSelected ? [] : dash);
    if (isSelected) {
      ctx.shadowBlur = 10;
      ctx.shadowColor = 'rgba(13, 110, 253, 0.4)';
    }
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 8);
    ctx.fill();
    if (isSelected || enabled) ctx.stroke();
    ctx.restore();
  },

  drawDiamond(ctx, x, y, width, height, isSelected, color = '#ffdfba', stroke = '#d4a017', border = {}) {
    const { width: bw = 1, dash = [], enabled = true } = border;
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = isSelected ? '#0d6efd' : stroke;
    ctx.lineWidth = isSelected ? 2 : bw;
    ctx.setLineDash(isSelected ? [] : dash);
    if (isSelected) {
      ctx.shadowBlur = 10;
      ctx.shadowColor = 'rgba(13, 110, 253, 0.4)';
    }
    ctx.beginPath();
    ctx.moveTo(x + width / 2, y);
    ctx.lineTo(x + width, y + height / 2);
    ctx.lineTo(x + width / 2, y + height);
    ctx.lineTo(x, y + height / 2);
    ctx.closePath();
    ctx.fill();
    if (isSelected || enabled) ctx.stroke();
    ctx.restore();
  },

  drawOval(ctx, x, y, width, height, isSelected, color = '#a8e6cf', stroke = '#3d8c40', border = {}) {
    const { width: bw = 1, dash = [], enabled = true } = border;
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = isSelected ? '#0d6efd' : stroke;
    ctx.lineWidth = isSelected ? 2 : bw;
    ctx.setLineDash(isSelected ? [] : dash);
    if (isSelected) {
      ctx.shadowBlur = 10;
      ctx.shadowColor = 'rgba(13, 110, 253, 0.4)';
    }
    ctx.beginPath();
    ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    if (isSelected || enabled) ctx.stroke();
    ctx.restore();
  },

  drawParallelogram(ctx, x, y, width, height, isSelected, color = '#d5c6f0', stroke = '#6a4fcf', border = {}) {
    const { width: bw = 1, dash = [], enabled = true } = border;
    const offset = Math.min(width * 0.2, 15);
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = isSelected ? '#0d6efd' : stroke;
    ctx.lineWidth = isSelected ? 2 : bw;
    ctx.setLineDash(isSelected ? [] : dash);
    if (isSelected) {
      ctx.shadowBlur = 10;
      ctx.shadowColor = 'rgba(13, 110, 253, 0.4)';
    }
    ctx.beginPath();
    ctx.moveTo(x + offset, y);
    ctx.lineTo(x + width, y);
    ctx.lineTo(x + width - offset, y + height);
    ctx.lineTo(x, y + height);
    ctx.closePath();
    ctx.fill();
    if (isSelected || enabled) ctx.stroke();
    ctx.restore();
  },

  drawSpeechBubble(ctx, x, y, width, height, isSelected, color = '#fff9c4', stroke = '#fbc02d', border = {}) {
    const { width: bw = 1, dash = [], enabled = true } = border;
    const actualColor = isSelected ? color : 'rgba(255,249,196,0.35)';
    const actualStroke = isSelected ? '#0d6efd' : stroke;
    ctx.save();
    ctx.fillStyle = actualColor;
    ctx.strokeStyle = actualStroke;
    ctx.lineWidth = isSelected ? 2 : bw;
    ctx.setLineDash(isSelected ? [] : dash);
    ctx.beginPath();

    let radius = 10;
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius - 15);
    ctx.quadraticCurveTo(x + width, y + height - 15, x + width - radius, y + height - 15);
    ctx.lineTo(x + 35, y + height - 15);
    ctx.lineTo(x + 15, y + height);
    ctx.lineTo(x + 25, y + height - 15);
    ctx.lineTo(x + radius, y + height - 15);
    ctx.quadraticCurveTo(x, y + height - 15, x, y + height - radius - 15);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();

    ctx.fill();
    if (isSelected || enabled) ctx.stroke();
    ctx.restore();
  },

  // ─── Extra shapes, only ever used for Comment-category nodes (see
  // canvas.js _drawNode / the long-press shape picker) - Flow shapes are
  // strictly limited to oval/diamond/rect/parallelogram. ──────────────
  _polygonPoints(cx, cy, rx, ry, sides, rotationDeg = -90) {
    const points = [];
    const rot = (rotationDeg * Math.PI) / 180;
    for (let i = 0; i < sides; i++) {
      const angle = rot + (i * 2 * Math.PI) / sides;
      points.push({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
    }
    return points;
  },

  _strokeFillPolygon(ctx, points, isSelected, color, stroke, border = {}) {
    const { width: bw = 1, dash = [], enabled = true } = border;
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = isSelected ? '#0d6efd' : stroke;
    ctx.lineWidth = isSelected ? 2 : bw;
    ctx.setLineDash(isSelected ? [] : dash);
    if (isSelected) {
      ctx.shadowBlur = 10;
      ctx.shadowColor = 'rgba(13, 110, 253, 0.4)';
    }
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
    ctx.fill();
    if (isSelected || enabled) ctx.stroke();
    ctx.restore();
  },

  drawTriangle(ctx, x, y, width, height, isSelected, color = '#e2e8f0', stroke = '#64748b', border = {}) {
    const points = [
      { x: x + width / 2, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ];
    this._strokeFillPolygon(ctx, points, isSelected, color, stroke, border);
  },

  drawPentagon(ctx, x, y, width, height, isSelected, color = '#e2e8f0', stroke = '#64748b', border = {}) {
    const cx = x + width / 2, cy = y + height / 2;
    const points = this._polygonPoints(cx, cy, width / 2, height / 2, 5);
    this._strokeFillPolygon(ctx, points, isSelected, color, stroke, border);
  },

  drawHexagon(ctx, x, y, width, height, isSelected, color = '#e2e8f0', stroke = '#64748b', border = {}) {
    const cx = x + width / 2, cy = y + height / 2;
    const points = this._polygonPoints(cx, cy, width / 2, height / 2, 6, 0);
    this._strokeFillPolygon(ctx, points, isSelected, color, stroke, border);
  },

  drawStar(ctx, x, y, width, height, isSelected, color = '#e2e8f0', stroke = '#64748b', border = {}) {
    const cx = x + width / 2, cy = y + height / 2;
    const outer = this._polygonPoints(cx, cy, width / 2, height / 2, 5);
    const inner = this._polygonPoints(cx, cy, width / 4, height / 4, 5, -90 + 36);
    const points = [];
    for (let i = 0; i < 5; i++) {
      points.push(outer[i]);
      points.push(inner[i]);
    }
    this._strokeFillPolygon(ctx, points, isSelected, color, stroke, border);
  },

  drawTrapezoid(ctx, x, y, width, height, isSelected, color = '#e2e8f0', stroke = '#64748b', border = {}) {
    const inset = Math.min(width * 0.22, 25);
    const points = [
      { x: x + inset, y },
      { x: x + width - inset, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ];
    this._strokeFillPolygon(ctx, points, isSelected, color, stroke, border);
  },

  // Draw 90-degree smart orthogonal line with Clean Fillet
  drawOrthogonalPath(ctx, startNode, endNode, isSelected = false, offset = 0, lineColor = '#343a40', arrowStyle = 'triangle', lineWidth = 2.5) {
    const sCenter = this.getCenter(startNode);
    const eCenter = this.getCenter(endNode);

    // Apply reciprocal offset (Shift line perpendicular to its direction)
    if (offset !== 0) {
      const dx = eCenter.x - sCenter.x;
      const dy = eCenter.y - sCenter.y;
      const len = Math.hypot(dx, dy);
      if (len > 1) {
        const nx = -dy / len;
        const ny = dx / len;
        sCenter.x += nx * offset;
        sCenter.y += ny * offset;
        eCenter.x += nx * offset;
        eCenter.y += ny * offset;
      }
    }

    // Calculate boundary points
    const p1 = startNode.isPoint ? { x: startNode.x, y: startNode.y } : this.getBoundaryIntersection(eCenter, sCenter, startNode);
    const p2 = endNode.isPoint ? { x: endNode.x, y: endNode.y } : this.getBoundaryIntersection(sCenter, eCenter, endNode);

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;

    // Determine routing orientation
    // If it's nearly straight, don't force a Z-break
    const TOLERANCE = 10;
    const points = [p1];
    let headAngle = 0;

    if (Math.abs(dx) > Math.abs(dy)) {
      // Primarily Horizontal
      if (Math.abs(dy) > TOLERANCE) {
        const midX = p1.x + dx / 2;
        points.push({ x: midX, y: p1.y });
        points.push({ x: midX, y: p2.y });
      }
      headAngle = dx > 0 ? 0 : Math.PI;
    } else {
      // Primarily Vertical
      if (Math.abs(dx) > TOLERANCE) {
        const midY = p1.y + dy / 2;
        points.push({ x: p1.x, y: midY });
        points.push({ x: p2.x, y: midY });
      }
      headAngle = dy > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    points.push(p2);

    // Render Path
    ctx.save();
    ctx.strokeStyle = isSelected ? '#0d6efd' : lineColor;
    ctx.lineWidth = isSelected ? lineWidth + 1 : lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();

    ctx.fillStyle = isSelected ? '#0d6efd' : lineColor;
    this.drawArrowhead(ctx, p2, headAngle, arrowStyle);
    ctx.restore();
  },

  // ─── Stub-based routing for shape-to-shape Flow lines ──────────────
  // drawOrthogonalPath() above exits each shape at whatever diagonal
  // point the straight line to the other shape's center happens to
  // cross - fine for one connection, but when several lines converge
  // near the same shape their bend points cluster at slightly different
  // diagonal spots and visually tangle (see chat history 2026-09-06 for
  // the reported screenshot). This routes every connection out through
  // one of the 4 cardinal sides instead, spreads multiple connections
  // sharing a side evenly along it, and adds a short straight stub
  // before the first bend - only used for real shape-to-shape edges
  // (see canvas.js drawEdges(): point-attached edges still use
  // drawOrthogonalPath, since a point has no "side" to exit from).
  getExitSide(node, otherCenter) {
    const center = this.getCenter(node);
    const dx = otherCenter.x - center.x;
    const dy = otherCenter.y - center.y;
    // Biased toward vertical (top/bottom) ports on purpose - a flowchart
    // reads top-to-bottom, so a target that's meaningfully BELOW (or
    // ABOVE) its source should route vertically even when it's also
    // offset sideways by somewhat more, reserving left/right for
    // connections that are genuinely more sideways than downward (a
    // sibling fanning out in the same row). Without this, a target only
    // a little further sideways than downward picked a horizontal port
    // purely because dx edged out dy by a hair - and a shape's left/right
    // side is exactly where an unrelated edge's own vertical run is
    // statistically most likely to also pass, since that's the corridor
    // between columns (see chat history 2026-09-07: "لو البيرنت فوق
    // والشايلد تحت فالإنبوت هايكون خارج من الجزء اللي اسفل"). 2.6 was
    // picked empirically on the QA test diagram: high enough that a
    // genuine sideways branch (e.g. a 3-way fork's outer children) still
    // exits sideways, low enough that a mostly-downward connection that
    // only happens to also drift sideways stays vertical.
    const VERTICAL_BIAS = 2.6;
    if (Math.abs(dx) > Math.abs(dy) * VERTICAL_BIAS) return dx >= 0 ? 'right' : 'left';
    return dy >= 0 ? 'bottom' : 'top';
  },

  getSidePoint(node, side, t) {
    const w = node.width || 100, h = node.height || 50;
    if (side === 'top') return { x: node.x + t * w, y: node.y };
    if (side === 'bottom') return { x: node.x + t * w, y: node.y + h };
    if (side === 'left') return { x: node.x, y: node.y + t * h };
    return { x: node.x + w, y: node.y + t * h };
  },

  getSideDirection(side) {
    if (side === 'top') return { x: 0, y: -1 };
    if (side === 'bottom') return { x: 0, y: 1 };
    if (side === 'left') return { x: -1, y: 0 };
    return { x: 1, y: 0 };
  },

  // Every connection leaving a given side of a shape exits from that
  // side's exact midpoint - a single shared point per side (one on the
  // right, one on the left, etc.), not spread along it. Multiple lines
  // sharing a side visually bundle together over the short stub and
  // only separate once they bend toward their own targets.
  //
  // exitOffset/entryOffset: a small perpendicular nudge (px) applied to
  // BOTH the doorway point and its stub end together, when 2+ edges
  // share the exact same exit or entry side (see canvas.js's
  // _computeEdgeSideInfo, which assigns these per edge). Without it,
  // two distinct edges that happen to leave the same side and run
  // parallel for a while (e.g. one terminates at the very next shape,
  // the other continues past it) sit perfectly on top of each other -
  // reading as one oddly bold/doubled line with a doubled arrowhead
  // rather than two separate connections. The nudge is tiny enough that
  // edges still read as "bundled through one doorway" at a glance, but
  // never fully overlap.
  // A vertical bend at x=midX between y1 and y2 (H-V-H routing) - or a
  // horizontal bend at y=midY between x1 and x2 (V-H-V) - can land right
  // on top of some OTHER shape the edge has nothing to do with, if that
  // shape just happens to sit between the source and target. The bend
  // then runs along/through that shape's border, reading as if the edge
  // starts or ends there instead of just passing near it (see chat
  // history 2026-09-07: a Decision->Process C edge's bend fell exactly
  // at Process B's right edge). Nudges the bend to just outside whichever
  // side of the obstacle is the smaller detour.
  _avoidObstaclesX(midX, y1, y2, obstacles, excludeIds) {
    const lo = Math.min(y1, y2),
      hi = Math.max(y1, y2);
    const PAD = 20;
    let x = midX;
    for (const node of obstacles || []) {
      if (!node || node.isPoint || excludeIds.has(node.id)) continue;
      const w = node.width || 120,
        h = node.height || 50;
      const left = node.x - PAD,
        right = node.x + w + PAD;
      const top = node.y - PAD,
        bottom = node.y + h + PAD;
      if (x <= left || x >= right) continue;
      if (hi <= top || lo >= bottom) continue;
      x = Math.abs(x - left) <= Math.abs(x - right) ? left : right;
    }
    return x;
  },

  _avoidObstaclesY(midY, x1, x2, obstacles, excludeIds) {
    const lo = Math.min(x1, x2),
      hi = Math.max(x1, x2);
    const PAD = 20;
    let y = midY;
    for (const node of obstacles || []) {
      if (!node || node.isPoint || excludeIds.has(node.id)) continue;
      const w = node.width || 120,
        h = node.height || 50;
      const left = node.x - PAD,
        right = node.x + w + PAD;
      const top = node.y - PAD,
        bottom = node.y + h + PAD;
      if (y <= top || y >= bottom) continue;
      if (hi <= left || lo >= right) continue;
      y = Math.abs(y - top) <= Math.abs(y - bottom) ? top : bottom;
    }
    return y;
  },

  // True if a straight horizontal run at height y across [xFrom,xTo] (or
  // a vertical run at x across [yFrom,yTo], for the X version below)
  // clips any obstacle - the read-only twin of _avoidObstaclesY/X's own
  // collision test, used to decide WHETHER a detour is needed before
  // committing to one.
  _legBlockedY(y, xFrom, xTo, obstacles, excludeIds) {
    const lo = Math.min(xFrom, xTo),
      hi = Math.max(xFrom, xTo);
    const PAD = 20;
    for (const node of obstacles || []) {
      if (!node || node.isPoint || excludeIds.has(node.id)) continue;
      const w = node.width || 120,
        h = node.height || 50;
      if (y <= node.y - PAD || y >= node.y + h + PAD) continue;
      if (hi <= node.x - PAD || lo >= node.x + w + PAD) continue;
      return true;
    }
    return false;
  },

  _legBlockedX(x, yFrom, yTo, obstacles, excludeIds) {
    const lo = Math.min(yFrom, yTo),
      hi = Math.max(yFrom, yTo);
    const PAD = 20;
    for (const node of obstacles || []) {
      if (!node || node.isPoint || excludeIds.has(node.id)) continue;
      const w = node.width || 120,
        h = node.height || 50;
      if (x <= node.x - PAD || x >= node.x + w + PAD) continue;
      if (hi <= node.y - PAD || lo >= node.y + h + PAD) continue;
      return true;
    }
    return false;
  },

  buildStubbedOrthogonalPoints(n1, side1, n2, side2, stubLen = null, exitOffset = 0, entryOffset = 0, obstacles = null) {
    let exitPoint = this.getSidePoint(n1, side1, 0.5);
    let entryPoint = this.getSidePoint(n2, side2, 0.5);
    const dir1 = this.getSideDirection(side1);
    const dir2 = this.getSideDirection(side2);
    // Stub length scales with each shape's own size (clamped) instead of
    // one fixed constant, so it stays proportionate whether the diagram
    // uses small or large shapes.
    const stub1 = stubLen ?? Math.max(14, Math.min(36, Math.min(n1.width || 120, n1.height || 50) * 0.3));
    const stub2 = stubLen ?? Math.max(14, Math.min(36, Math.min(n2.width || 120, n2.height || 50) * 0.3));
    let stubEnd1 = { x: exitPoint.x + dir1.x * stub1, y: exitPoint.y + dir1.y * stub1 };
    let stubEnd2 = { x: entryPoint.x + dir2.x * stub2, y: entryPoint.y + dir2.y * stub2 };

    if (exitOffset) {
      const axis = dir1.x !== 0 ? 'y' : 'x';
      exitPoint = { ...exitPoint, [axis]: exitPoint[axis] + exitOffset };
      stubEnd1 = { ...stubEnd1, [axis]: stubEnd1[axis] + exitOffset };
    }
    if (entryOffset) {
      const axis = dir2.x !== 0 ? 'y' : 'x';
      entryPoint = { ...entryPoint, [axis]: entryPoint[axis] + entryOffset };
      stubEnd2 = { ...stubEnd2, [axis]: stubEnd2[axis] + entryOffset };
    }

    const dx = stubEnd2.x - stubEnd1.x;
    const dy = stubEnd2.y - stubEnd1.y;
    // Generous tolerance: a connection that's only slightly off-axis
    // draws as one straight segment instead of a needless small zigzag -
    // bends are only worth it once the misalignment is real.
    const TOLERANCE = 30;
    const axis1Horizontal = dir1.x !== 0;
    const axis2Horizontal = dir2.x !== 0;
    const mid = [];
    if (axis1Horizontal === axis2Horizontal) {
      // Both ends leave on the same axis - a single straight segment is
      // only truly axis-aligned once the OTHER axis matches too, so only
      // check the perpendicular delta (checking both, like the old
      // `dx>TOL && dy>TOL` guard, let a real perpendicular offset slip
      // through undetected whenever the other delta happened to be small,
      // producing a visibly diagonal segment).
      const perpDelta = axis1Horizontal ? dy : dx;
      if (Math.abs(perpDelta) > TOLERANCE) {
        const excludeIds = new Set([n1.id, n2.id]);
        if (axis1Horizontal) {
          let midX = stubEnd1.x + dx / 2;
          if (obstacles) midX = this._avoidObstaclesX(midX, stubEnd1.y, stubEnd2.y, obstacles, excludeIds);
          // The bend check above only protects the one vertical segment at
          // x=midX - it never looks at the two HORIZONTAL runs leading up
          // to it, each fixed at a stub's own height for its whole x-span,
          // so a same-row neighbour sitting between the two shapes (not at
          // the bend's own x, just somewhere along the run) still got
          // grazed even with a "clear" bend (chat history 2026-09-08:
          // Process C's exit ran the rest of its way at Process B's own
          // row height). When that happens, route the WHOLE horizontal
          // crossing through one shared safe height instead of the two
          // shapes' own stub heights - a longer path, but still just one
          // pair of turns, not a multi-step staircase. An explicit user
          // call: prefer a longer route over a choppy one, and Flow lines
          // must never cross a Flow shape - never mind whether the bend
          // itself was already technically clear.
          const blocked = obstacles && (this._legBlockedY(stubEnd1.y, stubEnd1.x, midX, obstacles, excludeIds) || this._legBlockedY(stubEnd2.y, midX, stubEnd2.x, obstacles, excludeIds));
          if (blocked) {
            const safeY = this._avoidObstaclesY((stubEnd1.y + stubEnd2.y) / 2, stubEnd1.x, stubEnd2.x, obstacles, excludeIds);
            mid.push({ x: stubEnd1.x, y: safeY }, { x: stubEnd2.x, y: safeY });
          } else {
            mid.push({ x: midX, y: stubEnd1.y }, { x: midX, y: stubEnd2.y });
          }
        } else {
          let midY = stubEnd1.y + dy / 2;
          if (obstacles) midY = this._avoidObstaclesY(midY, stubEnd1.x, stubEnd2.x, obstacles, excludeIds);
          // Mirrored for vertical runs - see the horizontal case above.
          const blocked = obstacles && (this._legBlockedX(stubEnd1.x, stubEnd1.y, midY, obstacles, excludeIds) || this._legBlockedX(stubEnd2.x, midY, stubEnd2.y, obstacles, excludeIds));
          if (blocked) {
            const safeX = this._avoidObstaclesX((stubEnd1.x + stubEnd2.x) / 2, stubEnd1.y, stubEnd2.y, obstacles, excludeIds);
            mid.push({ x: safeX, y: stubEnd1.y }, { x: safeX, y: stubEnd2.y });
          } else {
            mid.push({ x: stubEnd1.x, y: midY }, { x: stubEnd2.x, y: midY });
          }
        }
      }
    } else {
      // One end leaves sideways, the other vertically - these can never
      // line up into a single straight orthogonal segment, so always
      // add the one elbow that keeps every segment axis-aligned.
      if (axis1Horizontal) mid.push({ x: stubEnd2.x, y: stubEnd1.y });
      else mid.push({ x: stubEnd1.x, y: stubEnd2.y });
    }
    return [exitPoint, stubEnd1, ...mid, stubEnd2, entryPoint];
  },

  // Draws an already-fully-specified polyline plus an arrowhead pointing
  // into the last point along the final segment's direction. lineColor
  // and arrowStyle come from Settings > Flow Engine Pro (or a diagram's
  // own override) - see canvas.js's `this.settings`.
  drawPolylinePath(ctx, points, isSelected, lineColor = '#1e293b', arrowStyle = 'triangle', lineWidth = 2.5) {
    ctx.save();
    ctx.strokeStyle = isSelected ? '#0d6efd' : lineColor;
    ctx.lineWidth = isSelected ? lineWidth + 1 : lineWidth;
    ctx.setLineDash([]);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();

    const last = points[points.length - 1];
    const prev = points[points.length - 2];
    const headAngle = Math.atan2(last.y - prev.y, last.x - prev.x);
    ctx.fillStyle = isSelected ? '#0d6efd' : lineColor;
    this.drawArrowhead(ctx, last, headAngle, arrowStyle);
    ctx.restore();
  },

  // Dispatches to one of the two arrowhead looks per Settings' Arrow
  // Head Style. Caller sets ctx.fillStyle before calling this.
  drawArrowhead(ctx, tip, angle, style = 'triangle') {
    if (style === 'notch') this.drawArrowheadNotch(ctx, tip, angle);
    else this.drawArrowheadTriangle(ctx, tip, angle);
  },

  // A clean, slim solid-triangle arrowhead - the standard look shared by
  // most modern diagram tools (draw.io, Miro, Lucidchart).
  drawArrowheadTriangle(ctx, tip, angle) {
    const headlen = 11;
    // Was PI/8 (22.5 deg half-angle) - narrow enough that at typical zoom
    // the two edges nearly overlap and anti-aliasing makes the head read
    // as a thin double-stroke blade rather than a clean triangle.
    const spread = Math.PI / 6;
    const left = { x: tip.x - headlen * Math.cos(angle - spread), y: tip.y - headlen * Math.sin(angle - spread) };
    const right = { x: tip.x - headlen * Math.cos(angle + spread), y: tip.y - headlen * Math.sin(angle + spread) };
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(left.x, left.y);
    ctx.lineTo(right.x, right.y);
    ctx.closePath();
    ctx.fill();
  },

  // Concave-back arrowhead (a notch pulled back toward the tip) - the
  // alternate style offered in Settings. Reads as messier when two
  // arrowheads sit right on top of each other (e.g. a merge junction),
  // which is why drawArrowheadTriangle is the default.
  drawArrowheadNotch(ctx, tip, angle) {
    const headlen = 12;
    const spread = Math.PI / 7;
    const notchDepth = headlen * 0.55;
    const left = { x: tip.x - headlen * Math.cos(angle - spread), y: tip.y - headlen * Math.sin(angle - spread) };
    const right = { x: tip.x - headlen * Math.cos(angle + spread), y: tip.y - headlen * Math.sin(angle + spread) };
    const notch = { x: tip.x - notchDepth * Math.cos(angle), y: tip.y - notchDepth * Math.sin(angle) };
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(left.x, left.y);
    ctx.lineTo(notch.x, notch.y);
    ctx.lineTo(right.x, right.y);
    ctx.closePath();
    ctx.fill();
  },

  // Small filled-circle markers at both ends of a selected line - the
  // same idea as the square corner handles a selected shape gets, so a
  // selected connector is just as clearly "this one" at a glance instead
  // of only a subtle color/width change.
  drawLineEndpointMarkers(ctx, start, end) {
    for (const p of [start, end]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#0d6efd';
      ctx.stroke();
    }
  },

  // Small solid dot marking a doorway where 2+ Flow lines deliberately
  // fuse into one trunk (a fork leaving a shape, or a merge entering
  // one) - see canvas.js's _getJunctionPoints. Same line color as the
  // strokes themselves so it reads as "the lines fuse here", not as a
  // separate interactive element (unlike a routing point, which is a
  // real draggable node and has its own distinct look).
  drawJunctionDot(ctx, point, color = '#1e293b') {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  },

  // Picks readable text color (near-black or white) for a given fill,
  // by actual luminance rather than one hardcoded hex ('#1e293b') - the
  // old check only flipped to white for that exact swatch, so any other
  // custom-picked dark/black fill left dark-on-dark, invisible text
  // (user report 2026-09-09: "handle black and white for flow shapes
  // generally, not just the one preset").
  getContrastTextColor(hexColor, darkText = '#1e293b', lightText = '#ffffff') {
    if (!hexColor || typeof hexColor !== 'string') return darkText;
    let hex = hexColor.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    if (hex.length !== 6) return darkText;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    if ([r, g, b].some(Number.isNaN)) return darkText;
    // Perceived brightness (standard luma weights), 0-255.
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    return luma < 140 ? lightText : darkText;
  },
};
