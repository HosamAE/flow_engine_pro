/** @odoo-module **/

// Edge routing / geometry - extracted out of canvas.js (2026-09-10 review:
// "canvas.js is a 2800+ line monolith"). This is the "figure out which
// cardinal side of each shape a line uses, and where the stub points go"
// cluster - genuinely self-contained logic, just previously living as
// methods on the FlowCanvas component. Each function here takes the
// component instance explicitly as `self` where it needs canvas data or
// other component methods, so the call sites in canvas.js are unchanged -
// this is a mechanical, behavior-preserving move, not a rewrite.

import { MathUtils } from '@flow_engine_pro/core/math_utils';

export function isFlowShapeNode(node) {
  return !!node && !node.isPoint && node.type !== 'comment' && node.type !== 'text' && !node.isCommentCategory;
}

export function getNodePorts(node) {
  return [
    { x: node.x + node.width / 2, y: node.y },
    { x: node.x + node.width, y: node.y + node.height / 2 },
    { x: node.x + node.width / 2, y: node.y + node.height },
    { x: node.x, y: node.y + node.height / 2 },
  ];
}

// Resolves what a given edge endpoint ultimately connects to, walking
// through a chain of routing points (isPoint) if needed. Returns the
// first non-point node found, or null if the chain dead-ends without
// ever reaching one (shouldn't normally happen, but guards against a
// point left with no other edge).
export function resolveEffectiveEndpoint(self, nodeId, cameFromEdgeId, visited = new Set()) {
  const node = self.getNode(nodeId);
  if (!node) return null;
  if (!node.isPoint) return node;
  if (visited.has(nodeId)) return null; // cycle guard
  visited.add(nodeId);
  for (const e of self.props.canvasData.edges) {
    if (e.id === cameFromEdgeId) continue;
    const sId = e.sourceNode || e.source;
    const tId = e.targetNode || e.target;
    if (sId === nodeId) {
      const result = resolveEffectiveEndpoint(self, tId, e.id, visited);
      if (result) return result;
    } else if (tId === nodeId) {
      const result = resolveEffectiveEndpoint(self, sId, e.id, visited);
      if (result) return result;
    }
  }
  return null;
}

// A Flow line only if THIS edge's own two ultimate ends (after walking
// through any routing points in between) are both real Flow shapes -
// deliberately NOT "does this edge sit in a connected component that
// happens to contain 2+ Flow shapes somewhere", which is what an
// earlier version of this check did and got wrong: a Comment node
// attached to an otherwise all-Flow network rendered its line solid
// just because its neighbour was well-connected (see chat history
// 2026-09-06 for the stress-test screenshot that caught this).
export function isFlowLine(self, edge) {
  const n1id = edge.sourceNode || edge.source;
  const n2id = edge.targetNode || edge.target;
  const end1 = resolveEffectiveEndpoint(self, n1id, edge.id);
  const end2 = resolveEffectiveEndpoint(self, n2id, edge.id);
  return isFlowShapeNode(end1) && isFlowShapeNode(end2);
}

// Figures out which cardinal side of each shape every real
// shape-to-shape connection exits/enters through - every connection
// sharing a side converges on that side's single midpoint (see
// MathUtils.buildStubbedOrthogonalPoints). Point-attached edges are
// excluded - a point has no "side", they keep using the older direct
// boundary-to-boundary routing. Shared by drawEdges() and
// _findHitEdge() so a line's clickable area always matches exactly
// what's drawn - computing this independently in each place would
// risk the two drifting apart.
export function computeEdgeSideInfo(self) {
  const edgeSideInfo = new Map();
  for (const edge of self.props.canvasData.edges) {
    const n1 = self.getNode(edge.sourceNode || edge.source);
    const n2 = self.getNode(edge.targetNode || edge.target);
    if (!n1 || !n2 || n1.isPoint || n2.isPoint) continue;
    if (!isFlowLine(self, edge)) continue; // Comment lines never use stub routing
    const c1 = MathUtils.getCenter(n1);
    const c2 = MathUtils.getCenter(n2);
    edgeSideInfo.set(edge, { side1: MathUtils.getExitSide(n1, c2), side2: MathUtils.getExitSide(n2, c1), n1: n1, n2: n2, exitOffset: 0, entryOffset: 0 });
  }

  // A doorway (node + side) used ONLY by edges leaving it (a fork) or
  // ONLY by edges entering it (a merge) is meant to bundle at one
  // shared point - that's the deliberate "trunk" look, and it stays
  // untouched. But a doorway used by a MIX of directions - one edge
  // terminating there, a DIFFERENT, unrelated edge originating there -
  // is a different situation entirely: those two edges have nothing to
  // do with each other, and bundling them at the same point makes the
  // incoming arrow's final approach and the outgoing edge's initial
  // stub run collinear, reading as a single line passing straight
  // through the shape (see chat history 2026-09-07: "هو الديسكشن رايح
  // بسهمين على بروسيس بي؟"). Only THAT mixed case gets nudged into two
  // distinct points a few pixels apart on the same side - a fixed
  // pixel offset (reusing buildStubbedOrthogonalPoints' existing
  // exitOffset/entryOffset, previously only fed 0) rather than a
  // fraction of the side's length, so the separation looks the same
  // regardless of shape size.
  const doorways = new Map();
  for (const [edge, info] of edgeSideInfo) {
    const exitKey = `${info.n1.id}|${info.side1}`;
    const entryKey = `${info.n2.id}|${info.side2}`;
    if (!doorways.has(exitKey)) doorways.set(exitKey, { exits: [], entries: [] });
    if (!doorways.has(entryKey)) doorways.set(entryKey, { exits: [], entries: [] });
    doorways.get(exitKey).exits.push(edge);
    doorways.get(entryKey).entries.push(edge);
  }
  // 12 read as one line; 20 sat too close to the shape's corner instead
  // of its centre; 14 was still a bit much (chat history 2026-09-07/08).
  // Settled on 10 - the smallest gap that still reads as two lines
  // rather than one thick one.
  const OFFSET_PX = 10;
  // Which of the pair gets the negative (toward the side's own top/left)
  // vs positive (toward its bottom/right) offset is a deliberate
  // convention, not arbitrary: entries sit toward the top/left slot,
  // exits toward the bottom/right one (user feedback 2026-09-07 - an
  // incoming line arriving into the upper slot and an outgoing line
  // leaving from the lower slot reads cleanly top-to-bottom, instead of
  // the two visually crossing paths if it were the other way around).
  for (const { exits, entries } of doorways.values()) {
    if (exits.length === 0 || entries.length === 0) continue; // pure fork/merge - leave bundled
    for (const edge of exits) edgeSideInfo.get(edge).exitOffset = OFFSET_PX;
    for (const edge of entries) edgeSideInfo.get(edge).entryOffset = -OFFSET_PX;
  }
  return edgeSideInfo;
}

// Builds the same stub-routed point list drawEdges() renders for a
// given edge, or null if it's point-attached (no "side" concept - the
// caller should fall back to the older boundary-to-boundary routing).
export function getStubbedPointsFor(self, edge, n1, n2, edgeSideInfo) {
  const sideInfo = edgeSideInfo.get(edge);
  if (!sideInfo) return null;
  return MathUtils.buildStubbedOrthogonalPoints(n1, sideInfo.side1, n2, sideInfo.side2, null, sideInfo.exitOffset, sideInfo.entryOffset, self.props.canvasData.nodes);
}

// Every doorway (a node's side) shared by 2+ edges ALL leaving it (a
// fork) or ALL entering it (a merge) is a deliberate junction, not an
// accidental overlap - those still bundle at one shared point on
// purpose (a trunk), so a dot marks it as "this is one intentional
// split/join". Exits and entries are counted SEPARATELY here on
// purpose: a doorway used by a MIX of directions no longer shares a
// point at all (see computeEdgeSideInfo's exitOffset/entryOffset
// nudge), so it needs no dot - drawing one at the old shared t=0.5
// spot would just be a stray dot floating between the two now-
// separated points.
export function getJunctionPoints(edgeSideInfo) {
  const exitGroups = new Map();
  const entryGroups = new Map();
  const bump = (map, node, side, offset) => {
    const key = `${node.id}|${side}`;
    if (!map.has(key)) map.set(key, { node, side, count: 0, offset });
    map.get(key).count++;
  };
  for (const info of edgeSideInfo.values()) {
    bump(exitGroups, info.n1, info.side1, info.exitOffset);
    bump(entryGroups, info.n2, info.side2, info.entryOffset);
  }
  const points = [];
  for (const { node, side, count, offset } of [...exitGroups.values(), ...entryGroups.values()]) {
    if (count < 2) continue;
    // A fork/merge group that ALSO happens to sit on a doorway mixed
    // with the opposite direction (see computeEdgeSideInfo) got
    // nudged off t=0.5 as a pair - follow it there instead of drawing
    // the dot at the old, now-empty center point.
    let point = MathUtils.getSidePoint(node, side, 0.5);
    if (offset) {
      const dir = MathUtils.getSideDirection(side);
      const axis = dir.x !== 0 ? 'y' : 'x';
      point = { ...point, [axis]: point[axis] + offset };
    }
    points.push(point);
  }
  return points;
}
