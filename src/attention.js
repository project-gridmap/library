import { mergeSegments, rectangleSegments } from './lines.js';

// One geographic chain for the frame. Pointer/press inspection takes priority;
// explicit focus supplies the persistent context. Selection is independent.
export function resolveAttention(model, focus = { level: 'map' }, inspected = null) {
  const cell = inspected ?? focus.cell ?? null;
  const item = cell ? model.items[cell.itemIndex] : focus.item ?? (focus.section ? model.items[focus.section.itemIndex] : null);
  const focused = focus.level === 'layer' ? focus.layer.items
    : focus.level === 'group' ? focus.group.items
    : focus.item ? [focus.item] : focus.cell ? [model.items[focus.cell.itemIndex]] : null;
  return {
    cell,
    items: new Set(item ? [item.index] : (focused ?? []).map((book) => book.index)),
    focused: focused ? new Set(focused.map((book) => book.index)) : null,
    section: cell && cell.sectionIndex >= 0 ? model.sections[cell.sectionIndex] ?? null : focus.section ?? null,
    focusedSection: focus.cell?.sectionIndex ?? focus.section?.index ?? null,
  };
}

export function markerAttention(cell, attention) {
  if (attention.section && cell.sectionIndex === attention.section.index) return 1;
  return attention.items.has(cell.itemIndex) ? 0.35 : 0;
}

// Partition only existing section lines. Half-gap dividers and open frames
// remain exactly where the model placed them; no new outlines are introduced.
export function sectionBorderParts(item, section) {
  const frame = rectangleSegments(item.inner);
  const segments = mergeSegments([...(item.openFrame ? frame.slice(0, 1) : frame), ...item.dividers]);
  if (!section) return { resting: segments, active: [] };
  const horizontal = item.inner.width >= item.inner.height;
  const index = item.sections.indexOf(section);
  const boundaries = horizontal
    ? [item.inner.x, ...item.dividers.map((d) => d.x1), item.inner.x + item.inner.width]
    : [item.inner.y, ...item.dividers.map((d) => d.y1), item.inner.y + item.inner.height];
  const region = horizontal
    ? { x: boundaries[index], y: item.inner.y, width: boundaries[index + 1] - boundaries[index], height: item.inner.height }
    : { x: item.inner.x, y: boundaries[index], width: item.inner.width, height: boundaries[index + 1] - boundaries[index] };
  const parts = { resting: [], active: [] };
  for (const edge of segments) {
    const alongX = edge.y1 === edge.y2;
    const at = alongX ? edge.y1 : edge.x1;
    const lo = alongX ? edge.x1 : edge.y1, hi = alongX ? edge.x2 : edge.y2;
    const near = (a, b) => Math.abs(a - b) < 1e-6;
    const onBoundary = alongX ? near(at, region.y) || near(at, region.y + region.height)
      : near(at, region.x) || near(at, region.x + region.width);
    const start = Math.max(lo, alongX ? region.x : region.y);
    const end = Math.min(hi, alongX ? region.x + region.width : region.y + region.height);
    if (!onBoundary || end <= start) { parts.resting.push(edge); continue; }
    const segment = (a, b) => alongX
      ? { x1: a, y1: at, x2: b, y2: at } : { x1: at, y1: a, x2: at, y2: b };
    if (lo < start) parts.resting.push(segment(lo, start));
    parts.active.push(segment(start, end));
    if (end < hi) parts.resting.push(segment(end, hi));
  }
  return parts;
}
