/** @odoo-module **/

// Auto-layout algorithm - extracted out of canvas.js (2026-09-10 review:
// "canvas.js is a 2800+ line monolith"). A layered (Sugiyama-style) BFS
// rank layout: pure data transformation, no component/DOM dependency -
// takes the diagram's nodes/edges and mutates their x/y in place, same
// as the original method did. Component-side effects (clearing
// selection, firing onChange) stay in canvas.js's thin wrapper.
export function layoutFlowDiagram(canvasData, includeComments = false) {
  const nodes = canvasData.nodes || [];
  const edges = canvasData.edges || [];

  const flowNodes = nodes.filter((n) => !n.isPoint && !n.isCommentCategory && n.type !== 'comment');
  if (flowNodes.length === 0) return;
  const flowIds = new Set(flowNodes.map((n) => n.id));

  const flowById = new Map(flowNodes.map((n) => [n.id, n]));
  const children = new Map(flowNodes.map((n) => [n.id, []]));
  const incoming = new Map(flowNodes.map((n) => [n.id, 0]));
  for (const e of edges) {
    const s = e.source || e.sourceNode;
    const t = e.target || e.targetNode;
    if (flowIds.has(s) && flowIds.has(t) && s !== t) {
      children.get(s).push(t);
      incoming.set(t, incoming.get(t) + 1);
    }
  }

  // Rank = longest BFS distance from a root. Cycles are broken by
  // never re-queuing a node already seen in the current root's pass.
  const rank = new Map();
  const roots = flowNodes.filter((n) => incoming.get(n.id) === 0);
  const startNodes = roots.length ? roots : [flowNodes[0]];
  for (const root of startNodes) {
    if (rank.has(root.id)) continue;
    const queue = [[root.id, 0]];
    const seenThisPass = new Set([root.id]);
    while (queue.length) {
      const [id, r] = queue.shift();
      rank.set(id, Math.max(rank.get(id) ?? 0, r));
      for (const childId of children.get(id) || []) {
        if (seenThisPass.has(childId)) continue;
        seenThisPass.add(childId);
        queue.push([childId, r + 1]);
      }
    }
  }
  // A Flow node never reached from any root (disconnected, or only
  // reachable via a cycle with no clear entry point) still needs a
  // rank of its own so it's placed somewhere instead of left at (0,0)
  // on top of everything else.
  let maxRank = 0;
  for (const r of rank.values()) maxRank = Math.max(maxRank, r);
  for (const n of flowNodes) {
    if (!rank.has(n.id)) rank.set(n.id, ++maxRank);
  }

  const byRank = new Map();
  for (const n of flowNodes) {
    const r = rank.get(n.id);
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r).push(n);
  }

  // Gaps scale with the average Flow shape size instead of a fixed
  // constant, so the layout doesn't look cramped for a diagram built
  // from large shapes or needlessly sparse for small ones.
  const avgW = flowNodes.reduce((s, n) => s + (n.width || 120), 0) / flowNodes.length;
  const avgH = flowNodes.reduce((s, n) => s + (n.height || 50), 0) / flowNodes.length;
  // Bumped both the floor and the multiplier - shapes connected side by
  // side (or top/bottom) with too little room between them made the
  // connector's own endpoint markers crowd right up against the
  // shape's rounded corner, looking cramped rather than smooth.
  const V_GAP = Math.max(140, avgH * 2.5);
  const H_GAP = Math.max(100, avgW * 1.5);
  const oldPos = new Map(flowNodes.map((n) => [n.id, { x: n.x, y: n.y }]));

  const sortedRanks = [...byRank.keys()].sort((a, b) => a - b);
  for (const r of sortedRanks) {
    const rowNodes = byRank.get(r);
    const rowWidth = rowNodes.reduce((sum, n) => sum + (n.width || 120) + H_GAP, -H_GAP);
    let x = -rowWidth / 2;
    for (const n of rowNodes) {
      n.x = x;
      n.y = r * V_GAP;
      x += (n.width || 120) + H_GAP;
    }
  }

  // Straighten links by aligning each parent with its children so
  // connectors draw as straight as possible. A single-child node aligns
  // straight under that one child (a plain linear chain reads best as
  // one unbroken line). A multi-child node (a Decision's fork) aligns
  // to the AVERAGE center of its children instead, so it sits centered
  // above its own fork - symmetric branches either side - rather than
  // leaning toward whichever child happened to be created first (user
  // request 2026-09-09: "lean the layout toward symmetry").
  // Processed deepest-rank-first so a parent aligns with children that
  // have already reached their own final x.
  //
  // Critical guard: only align with children that have exactly ONE
  // parent (this one). A merge point (2+ branches converging on one
  // node) would otherwise have every one of its parents try to claim
  // the same x for themselves, collapsing them all on top of each other
  // - exactly the "children stacked on each other" bug this caused
  // before the guard was added (chat history 2026-09-06).
  for (const r of [...sortedRanks].reverse()) {
    for (const n of byRank.get(r)) {
      const kids = children.get(n.id) || [];
      if (kids.length === 0) continue; // leaf, keep its centered position
      const eligibleCenters = [];
      for (const kidId of kids) {
        if ((incoming.get(kidId) || 0) !== 1) continue; // merge point - don't fight over it
        const kid = flowById.get(kidId);
        if (!kid) continue;
        eligibleCenters.push(kid.x + (kid.width || 120) / 2);
      }
      if (!eligibleCenters.length) continue;
      const avgCenterX = eligibleCenters.reduce((a, b) => a + b, 0) / eligibleCenters.length;
      n.x = avgCenterX - (n.width || 120) / 2;
    }
  }

  // Routing points always just travel by the same delta as whichever
  // Flow shape they're connected to - they're purely a routing detail
  // of that connection, never something to place deliberately.
  const points = nodes.filter((n) => n.isPoint);
  const commentNodes = nodes.filter((n) => n.isCommentCategory || n.type === 'comment');
  const findAnchorId = (n) => {
    const relatedEdge = edges.find((e) => (e.source || e.sourceNode) === n.id || (e.target || e.targetNode) === n.id);
    if (!relatedEdge) return null;
    const otherId = (relatedEdge.source || relatedEdge.sourceNode) === n.id ? relatedEdge.target || relatedEdge.targetNode : relatedEdge.source || relatedEdge.sourceNode;
    return flowIds.has(otherId) ? otherId : null;
  };
  for (const n of points) {
    const anchorId = findAnchorId(n);
    if (!anchorId) continue;
    const anchor = flowById.get(anchorId);
    const oldAnchorPos = oldPos.get(anchorId);
    if (!anchor || !oldAnchorPos) continue;
    n.x += anchor.x - oldAnchorPos.x;
    n.y += anchor.y - oldAnchorPos.y;
  }

  if (includeComments) {
    // Deliberately place Comments in a clear margin to the right of
    // the whole diagram (not immediately beside their own anchor -
    // that collided with whichever Flow shape happened to already be
    // sitting there, e.g. a sibling branch in the same row - see chat
    // history 2026-09-06 for the screenshot where a comment landed
    // directly on top of another shape). Each one's Y still lines up
    // with its anchor's row, so it reads as "this row's annotation"
    // even though X is a shared lane, and stacks under the previous
    // comment if that row already has one so multiple comments in the
    // same row don't overlap each other either.
    const marginX = Math.max(...flowNodes.map((n) => n.x + (n.width || 120))) + 90;
    const C_GAP = 16;
    const byAnchor = new Map();
    for (const c of commentNodes) {
      const anchorId = findAnchorId(c);
      if (!anchorId) continue; // no resolvable anchor - leave exactly where it was
      if (!byAnchor.has(anchorId)) byAnchor.set(anchorId, []);
      byAnchor.get(anchorId).push(c);
    }
    const rowsUsed = new Map(); // anchor.y -> next free y in that row's stack
    for (const [anchorId, comments] of byAnchor) {
      const anchor = flowById.get(anchorId);
      if (!anchor) continue;
      let y = rowsUsed.get(anchor.y) ?? anchor.y;
      for (const c of comments) {
        c.x = marginX;
        c.y = y;
        y += (c.height || 50) + C_GAP;
      }
      rowsUsed.set(anchor.y, y);
    }
  } else {
    // Normal (short-click) layout: comments just travel by delta, same
    // as points, so they stay wherever they were relative to their
    // anchor instead of being moved without being asked to.
    for (const n of commentNodes) {
      const anchorId = findAnchorId(n);
      if (!anchorId) continue;
      const anchor = flowById.get(anchorId);
      const oldAnchorPos = oldPos.get(anchorId);
      if (!anchor || !oldAnchorPos) continue;
      n.x += anchor.x - oldAnchorPos.x;
      n.y += anchor.y - oldAnchorPos.y;
    }
  }
}
