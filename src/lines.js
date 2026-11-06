// Union collinear edges before stroking: shared boundaries keep one weight,
// including rows whose chapter cells have different widths.
export function mergeSegments(segments) {
  const lines = new Map();
  for (const s of segments) {
    const horizontal = Math.abs(s.y2 - s.y1) < 1e-6;
    const at = horizontal ? s.y1 : s.x1;
    const key = `${horizontal ? 'h' : 'v'}:${Math.round(at * 1e6)}`;
    if (!lines.has(key)) lines.set(key, { horizontal, at, spans: [] });
    lines.get(key).spans.push(horizontal
      ? [Math.min(s.x1, s.x2), Math.max(s.x1, s.x2)]
      : [Math.min(s.y1, s.y2), Math.max(s.y1, s.y2)]);
  }
  const result = [];
  for (const { horizontal, at, spans } of lines.values()) {
    spans.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const [lo, hi] of spans) {
      const previous = merged.at(-1);
      if (previous && lo <= previous[1] + 1e-6) previous[1] = Math.max(previous[1], hi);
      else merged.push([lo, hi]);
    }
    for (const [lo, hi] of merged) result.push(horizontal
      ? { x1: lo, y1: at, x2: hi, y2: at }
      : { x1: at, y1: lo, x2: at, y2: hi });
  }
  return result;
}

export function rectangleSegments(r) {
  return [
    { x1: r.x, y1: r.y, x2: r.x + r.width, y2: r.y },
    { x1: r.x, y1: r.y + r.height, x2: r.x + r.width, y2: r.y + r.height },
    { x1: r.x, y1: r.y, x2: r.x, y2: r.y + r.height },
    { x1: r.x + r.width, y1: r.y, x2: r.x + r.width, y2: r.y + r.height },
  ];
}

// Split shared edges at every junction, then give each stretch one owner.
// Earlier items in input order take priority (biblical order in the demo).
// Layer perimeters keep their weight but inherit the adjacent item's colour.
export function ownedBorderSegments(items, layers) {
  const lines = new Map();
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  for (const item of [...items].sort((a, b) => a.index - b.index)) {
    const layer = layers[item.layerIndex];
    rectangleSegments(item).forEach((edge, side) => {
      const horizontal = side < 2;
      const at = horizontal ? edge.y1 : edge.x1;
      const lo = horizontal ? edge.x1 : edge.y1;
      const hi = horizontal ? edge.x2 : edge.y2;
      const key = `${horizontal ? 'h' : 'v'}:${Math.round(at * 1e6)}`;
      if (!lines.has(key)) lines.set(key, { horizontal, at, edges: [] });
      const outer = horizontal
        ? near(at, layer.y) || near(at, layer.y + layer.height)
        : near(at, layer.x) || near(at, layer.x + layer.width);
      lines.get(key).edges.push({ lo, hi, item, outer });
    });
  }
  const result = { item: [], group: [], layer: [] };
  for (const { horizontal, at, edges } of lines.values()) {
    const points = edges.flatMap((edge) => [edge.lo, edge.hi]).sort((a, b) => a - b)
      .filter((point, i, all) => i === 0 || !near(point, all[i - 1]));
    for (let i = 1; i < points.length; i++) {
      const lo = points[i - 1], hi = points[i], middle = (lo + hi) / 2;
      const neighbours = edges.filter((edge) => edge.lo < middle && edge.hi > middle);
      if (!neighbours.length) continue;
      const owner = neighbours.reduce((first, edge) => edge.item.index < first.item.index ? edge : first).item;
      const level = neighbours.some((edge) => edge.outer) ? 'layer'
        : new Set(neighbours.map((edge) => edge.item.groupIndex)).size > 1 ? 'group' : 'item';
      result[level].push(horizontal
        ? { x1: lo, y1: at, x2: hi, y2: at, owner }
        : { x1: at, y1: lo, x2: at, y2: hi, owner });
    }
  }
  return result;
}
