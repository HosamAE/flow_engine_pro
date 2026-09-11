/** @odoo-module **/

// Interaction helpers - extracted out of canvas.js (2026-09-10 review:
// "canvas.js is a 2800+ line monolith"). The actual DOM event handlers
// (onMouseDown/onMouseMove/onMouseUp/onDblClick/_onKeyDown/_onKeyUp) stay
// as component methods in canvas.js - they're the real event-wiring glue
// and share a lot of live drag/resize state across a single gesture,
// which makes them the riskiest part of the file to split apart. What
// moves here is the reusable, mostly-read-only logic those handlers lean
// on: hit-testing and geometry. Functions that need canvas data or other
// component methods take the component instance explicitly as `self`,
// same pattern as canvas_routing.js/canvas_layout.js.

import { MathUtils } from '@flow_engine_pro/core/math_utils';

export function findHitNode(self, worldPos) {
  if (!self.props.canvasData || !self.props.canvasData.nodes) return null;

  // Search backwards (top-to-bottom in z-index)
  for (let i = self.props.canvasData.nodes.length - 1; i >= 0; i--) {
    const node = self.props.canvasData.nodes[i];

    if (node.isPoint) {
      // Point: circular hit area (radius 15)
      // Now x,y IS the center
      if (Math.hypot(worldPos.x - node.x, worldPos.y - node.y) <= 15) return node;
    } else {
      // Shape: rectangular hit area
      const w = node.width || 100;
      const h = node.height || 50;
      if (worldPos.x >= node.x && worldPos.x <= node.x + w && worldPos.y >= node.y && worldPos.y <= node.y + h) {
        return node;
      }
    }
  }
  return null;
}

export function pointToSegmentDist(px, py, x1, y1, x2, y2) {
  const l2 = Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2);
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

export function getOrthogonalSegments(startNode, endNode) {
  const sC = MathUtils.getCenter(startNode),
    eC = MathUtils.getCenter(endNode);
  const p1 = startNode.isPoint ? { x: startNode.x, y: startNode.y } : MathUtils.getBoundaryIntersection(eC, sC, startNode);
  const p2 = endNode.isPoint ? { x: endNode.x, y: endNode.y } : MathUtils.getBoundaryIntersection(sC, eC, endNode);
  const dx = p2.x - p1.x,
    dy = p2.y - p1.y,
    segments = [];
  if (Math.abs(dx) > Math.abs(dy)) {
    if (Math.abs(dy) > 10) {
      const midX = p1.x + dx / 2;
      segments.push({ p1, p2: { x: midX, y: p1.y } }, { p1: { x: midX, y: p1.y }, p2: { x: midX, y: p2.y } }, { p1: { x: midX, y: p2.y }, p2 });
    } else segments.push({ p1, p2 });
  } else {
    if (Math.abs(dx) > 10) {
      const midY = p1.y + dy / 2;
      segments.push({ p1, p2: { x: p1.x, y: midY } }, { p1: { x: p1.x, y: midY }, p2: { x: p2.x, y: midY } }, { p1: { x: p2.x, y: midY }, p2 });
    } else segments.push({ p1, p2 });
  }
  return segments;
}

export function findHitEdge(self, worldPos) {
  const THRESHOLD = 10;
  const edgeSideInfo = self._computeEdgeSideInfo();
  for (const edge of self.props.canvasData.edges) {
    const n1 = self.getNode(edge.sourceNode || edge.source);
    const n2 = self.getNode(edge.targetNode || edge.target);
    if (!n1 || !n2) continue;

    const isSolid = self._isFlowLine(edge);

    if (isSolid) {
      // Same stub-routed points drawEdges() actually renders (or the
      // older direct routing for a point-attached edge) - hit-testing
      // a different path than what's drawn would make lines hard to
      // click accurately.
      const points = self._getStubbedPointsFor(edge, n1, n2, edgeSideInfo);
      const segments = points
        ? points.slice(0, -1).map((p, i) => ({ p1: p, p2: points[i + 1] }))
        : getOrthogonalSegments(n1, n2);
      for (const seg of segments) {
        if (pointToSegmentDist(worldPos.x, worldPos.y, seg.p1.x, seg.p1.y, seg.p2.x, seg.p2.y) < THRESHOLD) return edge;
      }
    } else {
      if (pointToSegmentDist(worldPos.x, worldPos.y, n1.x, n1.y, n2.x, n2.y) < THRESHOLD) return edge;
    }
  }
  return null;
}

export function getResizeHandles(node) {
  if (node.isPoint) return [];
  const { x, y, width: w, height: h } = node;
  return [
    { dir: 'nw', x: x, y: y },
    { dir: 'ne', x: x + w, y: y },
    { dir: 'se', x: x + w, y: y + h },
    { dir: 'sw', x: x, y: y + h },
  ];
}
