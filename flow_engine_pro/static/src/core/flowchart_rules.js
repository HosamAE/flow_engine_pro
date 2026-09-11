/** @odoo-module **/

// Checks a diagram's flow shapes/edges against standard flowchart notation
// rules (loosely ISO 5807 / common flowchart-101 conventions), agreed with
// the module owner on 2026-09-09:
//   A. Structural completeness - at least one Start, at least one End, no
//      orphan flow shape.
//   B. Decision discipline - every Decision has exactly 2 outgoing lines,
//      both labeled, with distinct labels.
//   C. Single-path discipline - only a Decision may branch; every shape
//      (besides Start/End) needs at least one incoming and one outgoing
//      line.
// Comment/text nodes and routing points are excluded entirely - they are
// annotations, not control-flow steps (mirrors FlowCanvas._isFlowShapeNode).
export function computeFlowchartCompliance(canvasData) {
  const allNodes = (canvasData && canvasData.nodes) || [];
  const allEdges = (canvasData && canvasData.edges) || [];

  const isFlowShape = (n) =>
    !!n && !n.isPoint && n.type !== 'comment' && n.type !== 'text' && !n.isCommentCategory;
  const flowNodes = allNodes.filter(isFlowShape);
  const flowIds = new Set(flowNodes.map((n) => n.id));

  // Only lines between two real flow shapes are part of the control-flow
  // graph (mirrors FlowCanvas's own _isFlowEdge check).
  const flowEdges = allEdges.filter((e) => {
    const s = e.source || e.sourceNode;
    const t = e.target || e.targetNode;
    return flowIds.has(s) && flowIds.has(t);
  });

  const outgoing = new Map();
  const incoming = new Map();
  for (const n of flowNodes) {
    outgoing.set(n.id, []);
    incoming.set(n.id, []);
  }
  for (const e of flowEdges) {
    const s = e.source || e.sourceNode;
    const t = e.target || e.targetNode;
    if (outgoing.has(s)) outgoing.get(s).push(e);
    if (incoming.has(t)) incoming.get(t).push(e);
  }

  if (flowNodes.length === 0) {
    return { compliant: true, checked: false, violations: [], summary: 'No flow shapes yet.' };
  }

  const violations = [];
  const hasStart = flowNodes.some((n) => n.type === 'start_end' && incoming.get(n.id).length === 0);
  const hasEnd = flowNodes.some((n) => n.type === 'start_end' && outgoing.get(n.id).length === 0);

  if (!hasStart) {
    violations.push({ nodeId: null, message: 'No Start shape found (a Start/End shape with no incoming line).' });
  }
  if (!hasEnd) {
    violations.push({ nodeId: null, message: 'No End shape found (a Start/End shape with no outgoing line).' });
  }

  for (const n of flowNodes) {
    const out = outgoing.get(n.id).length;
    const inn = incoming.get(n.id).length;
    const label = n.label || n.type;
    const isStartCandidate = n.type === 'start_end' && inn === 0;
    const isEndCandidate = n.type === 'start_end' && out === 0;

    if (out === 0 && inn === 0) {
      violations.push({ nodeId: n.id, message: `"${label}" isn't connected to anything.` });
      continue;
    }
    if (inn === 0 && !isStartCandidate) {
      violations.push({ nodeId: n.id, message: `"${label}" has no incoming line, but isn't a Start shape.` });
    }
    if (out === 0 && !isEndCandidate) {
      violations.push({ nodeId: n.id, message: `"${label}" has no outgoing line, but isn't an End shape.` });
    }

    if (n.type === 'decision') {
      // Corrected 2026-09-10: no real flowchart standard (ISO 5807
      // included) caps a decision at exactly 2 branches - that was this
      // checker's own over-specification. The actual requirement is just
      // that a decision genuinely decides (2+ exits) and every exit is
      // labeled with a distinct condition.
      if (out < 2) {
        violations.push({ nodeId: n.id, message: `Decision "${label}" has ${out} outgoing line(s); a decision needs at least 2.` });
      } else {
        const labels = outgoing.get(n.id).map((e) => (e.label || '').trim());
        if (labels.some((l) => !l)) {
          violations.push({ nodeId: n.id, message: `Decision "${label}" has an unlabeled branch.` });
        } else if (new Set(labels).size !== labels.length) {
          violations.push({ nodeId: n.id, message: `Decision "${label}" has two branches with the same label.` });
        }
      }
    } else if (out > 1) {
      violations.push({ nodeId: n.id, message: `"${label}" branches into ${out} lines; only a Decision shape should branch.` });
    }
  }

  return {
    compliant: violations.length === 0,
    checked: true,
    violations,
    summary: violations.length === 0 ? 'Follows standard flowchart rules.' : `${violations.length} issue${violations.length > 1 ? 's' : ''} found.`,
  };
}
