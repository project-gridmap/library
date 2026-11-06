// Candidates are ordered from richest to simplest. Upgrades need a little
// extra room; the current form stays until it no longer fits.
export function fitLabel(candidates, available, previous, buffer = 6) {
  const previousIndex = candidates.findIndex((candidate) => candidate.key === previous);
  const rank = previousIndex < 0 ? candidates.length : previousIndex;
  return candidates.find((candidate, index) => candidate.width
    + (previous !== undefined && index < rank ? buffer : 0) <= available) ?? null;
}

// Group identity comes first. A range is supplementary detail, and fragments
// of a name are never substituted for a meaningful full or editorial name.
export function fitSectionLabel(section, available, measure, range, showRange) {
  const names = [section.label, section.shortLabel].filter(Boolean);
  const name = names.find((candidate) => measure(candidate.toUpperCase()) <= available);
  if (!name) return null;
  const text = name.toUpperCase();
  const tail = showRange && measure(`${text} ${range}`) + 6 <= available ? ` ${range}` : '';
  return { name: text, tail };
}

// Find free space along an existing horizontal region boundary. Captions yield
// to the labels already there and never alter the region's shape or position.
export function boundaryLabelPosition(segments, width, height, occupied, viewport) {
  const candidates = [];
  for (const edge of segments) {
    if (Math.abs(edge.y1 - edge.y2) > 1e-6) continue;
    const top = edge.y1 - height / 2;
    if (top < 0 || top + height > viewport.h) continue;
    const start = Math.max(0, Math.min(edge.x1, edge.x2) + 6);
    const end = Math.min(viewport.w, Math.max(edge.x1, edge.x2) - 10);
    const blockers = occupied.filter((box) => box.y < top + height + 4 && box.y + box.height + 4 > top)
      .map((box) => [box.x - 4, box.x + box.width + 4]).sort((a, b) => a[0] - b[0]);
    let cursor = start;
    for (const [left, right] of [...blockers, [end, end]]) {
      const limit = Math.min(left, end);
      if (limit - cursor >= width) candidates.push({ x: cursor + (limit - cursor - width) / 2, y: top, width, height, room: limit - cursor });
      cursor = Math.max(cursor, right);
      if (cursor >= end) break;
    }
  }
  return candidates.sort((a, b) => b.room - a.room || a.y - b.y)[0] ?? null;
}

// Establish a preferred point once in the map's neutral overview. Even a
// caption that cannot fit yet gets an anchor, so later zoom can reveal it.
export function boundaryLabelAnchor(segments, width, height, occupied, viewport) {
  const box = boundaryLabelPosition(segments, width, height, occupied, viewport);
  const horizontal = segments.filter((edge) => Math.abs(edge.y1 - edge.y2) < 1e-6);
  const edge = box ? horizontal.find((candidate) => Math.abs(candidate.y1 - box.y - height / 2) < 1e-6
    && Math.min(candidate.x1, candidate.x2) <= box.x
    && Math.max(candidate.x1, candidate.x2) >= box.x + width)
    : horizontal.sort((a, b) => Math.abs(b.x2 - b.x1) - Math.abs(a.x2 - a.x1)
      || b.y1 - a.y1 || a.x1 - b.x1)[0];
  if (!edge) return null;
  return {
    x: box ? box.x + width / 2 : (edge.x1 + edge.x2) / 2,
    y: edge.y1, left: Math.min(edge.x1, edge.x2), right: Math.max(edge.x1, edge.x2),
  };
}

// Never search for a replacement here. Crowding, clipping or a short edge
// temporarily hides the caption while its preferred point stays unchanged.
export function anchoredBoundaryLabelPosition(anchor, width, height, occupied, viewport) {
  if (!anchor) return null;
  const box = { x: anchor.x - width / 2, y: anchor.y - height / 2, width, height };
  if (box.x < anchor.left + 6 || box.x + width > anchor.right - 10
    || box.x < 0 || box.x + width > viewport.w || box.y < 0 || box.y + height > viewport.h) return null;
  if (occupied.some((other) => box.x < other.x + other.width + 4 && box.x + width + 4 > other.x
    && box.y < other.y + other.height + 4 && box.y + height + 4 > other.y)) return null;
  return box;
}
