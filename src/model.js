'use strict';

export const DEFAULT_WORLDS = {
  portrait: { x: 0, y: 0, width: 1000, height: 1900, gutter: 30 },
  landscape: { x: 0, y: 0, width: 1600, height: 1000, gutter: 30 },
};

// World shapes (width / height) the 'fit' layout snaps to: few enough that
// each can be checked by eye, and one device always sees the same map.
export const DEFAULT_FIT_RATIOS = [0.5, 0.6, 0.7, 0.85, 1, 1.25, 1.6];

// The fit ratio nearest an aspect, on a log scale. The current ratio is kept
// unless another is nearer by more than `slack`, so a small resize (a phone's
// address bar collapsing) doesn't reshuffle the map back and forth.
export function pickFitRatio(aspect, ratios = DEFAULT_FIT_RATIOS, current = null, slack = 0.1) {
  const valid = (ratios ?? []).filter((ratio) => Number.isFinite(ratio) && ratio > 0);
  const options = valid.length ? valid : DEFAULT_FIT_RATIOS;
  const target = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const distance = (ratio) => Math.abs(Math.log(target / ratio));
  const best = options.reduce((a, b) => (distance(b) < distance(a) ? b : a));
  return options.includes(current) && distance(current) - distance(best) <= slack ? current : best;
}

export function fitWorld(ratio, gutter = 30) {
  return { x: 0, y: 0, width: 1000, height: 1000 / ratio, gutter };
}

export const DEFAULT_SECTION_GAP = 0;
export const DEFAULT_SECTION_PADDING = 0.6;

const EPS = 1e-6;
const near = (a, b) => Math.abs(a - b) < EPS;
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const cellCount = (item) => item.cells.length;
const weightSum = (items) => items.reduce((sum, item) => sum + item.n, 0);

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function normaliseCell(cell, index) {
  if (typeof cell === 'string' || typeof cell === 'number') {
    return { id: String(cell), label: String(cell), value: null, meta: {} };
  }
  assertObject(cell, `cell ${index + 1}`);
  const id = cell.id ?? String(index + 1);
  return {
    ...cell,
    id: String(id),
    label: String(cell.label ?? id),
    value: Number.isFinite(cell.value) ? cell.value : null,
    meta: cell.meta ?? {},
  };
}

function normaliseItem(item, index) {
  assertObject(item, `item ${index + 1}`);
  const id = item.id ?? item.key ?? slug(item.label ?? item.name ?? `item-${index + 1}`);
  const cells = item.cells ?? Array.from({ length: item.cellCount ?? item.cellsCount ?? 0 }, (_, i) => i + 1);
  if (!Array.isArray(cells) || cells.length === 0) {
    throw new TypeError(`item ${id} must include at least one cell`);
  }
  return {
    ...item,
    id: String(id),
    label: String(item.label ?? item.name ?? id),
    shortLabel: item.shortLabel ? String(item.shortLabel) : String(item.key ?? id),
    cells: cells.map(normaliseCell),
    meta: item.meta ?? {},
  };
}

function normaliseGroup(group, index) {
  assertObject(group, `group ${index + 1}`);
  const id = group.id ?? slug(group.label ?? group.name ?? `group-${index + 1}`);
  const items = group.items ?? [];
  if (!Array.isArray(items) || items.length === 0) {
    throw new TypeError(`group ${id} must include at least one item`);
  }
  return {
    ...group,
    id: String(id),
    label: String(group.label ?? group.name ?? id),
    items: items.map(normaliseItem),
    meta: group.meta ?? {},
  };
}

function normaliseLayer(layer, index) {
  assertObject(layer, `layer ${index + 1}`);
  const id = layer.id ?? slug(layer.label ?? layer.name ?? `layer-${index + 1}`);
  const groups = layer.groups ?? (Array.isArray(layer.items)
    ? [{ id: 'default', label: String(layer.label ?? layer.name ?? id), items: layer.items }]
    : []);
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new TypeError(`layer ${id} must include at least one group`);
  }
  return {
    ...layer,
    id: String(id),
    label: String(layer.label ?? layer.name ?? id),
    groups: groups.map(normaliseGroup),
    meta: layer.meta ?? {},
  };
}

export function normaliseGridmapData(data) {
  assertObject(data, 'gridmap data');
  if (!Array.isArray(data.layers) || data.layers.length === 0) {
    throw new TypeError('gridmap data must include at least one layer');
  }
  return {
    ...data,
    layers: data.layers.map(normaliseLayer),
    meta: data.meta ?? {},
  };
}

export const itemsOf = (layer) => layer.groups.flatMap((group) =>
  group.items.map((item) => ({ ...item, groupId: group.id, groupLabel: group.label, groupMeta: group.meta })));

function rowCounts(n, rows) {
  const base = Math.floor(n / rows);
  const extra = n % rows;
  return Array.from({ length: rows }, (_, i) => base + (i >= rows - extra ? 1 : 0));
}

function gridCost(n, width, height, rows) {
  let sum = 0;
  let worst = 0;
  for (const count of rowCounts(n, rows)) {
    const error = Math.log((width / count) / (height * count / n)) ** 2;
    sum += count * error;
    worst = Math.max(worst, error);
  }
  return sum + 2 * worst;
}

function bestGrid(n, width, height) {
  let best = { rows: 1, cost: Infinity };
  for (let rows = 1; rows <= n; rows += 1) {
    const cost = gridCost(n, width, height, rows);
    if (cost < best.cost) best = { rows, cost };
  }
  return best;
}

function cut(rect, fraction) {
  return rect.width >= rect.height
    ? [
      { x: rect.x, y: rect.y, width: rect.width * fraction, height: rect.height },
      { x: rect.x + rect.width * fraction, y: rect.y, width: rect.width * (1 - fraction), height: rect.height },
    ]
    : [
      { x: rect.x, y: rect.y, width: rect.width, height: rect.height * fraction },
      { x: rect.x, y: rect.y + rect.height * fraction, width: rect.width, height: rect.height * (1 - fraction) },
    ];
}

const SPLIT_CANDIDATES = 3;

function partitionItems(items, rect) {
  if (items.length === 1) {
    return { cost: bestGrid(items[0].n, rect.width, rect.height).cost, regions: [{ ...items[0], rect }] };
  }

  const total = weightSum(items);
  const splits = [];
  for (let k = 1, acc = 0; k < items.length; k += 1) {
    acc += items[k - 1].n;
    splits.push({ k, imbalance: Math.abs(acc - total / 2) });
  }
  splits.sort((a, b) => a.imbalance - b.imbalance || a.k - b.k);

  let best = null;
  for (const { k } of splits.slice(0, SPLIT_CANDIDATES)) {
    const first = items.slice(0, k);
    const rest = items.slice(k);
    const [aRect, bRect] = cut(rect, weightSum(first) / total);
    const a = partitionItems(first, aRect);
    const b = partitionItems(rest, bRect);
    if (!best || a.cost + b.cost < best.cost) {
      best = { cost: a.cost + b.cost, regions: [...a.regions, ...b.regions] };
    }
  }
  return best;
}

function layoutCells(cells, x, y, width, height) {
  const regions = [];
  let cy = y;
  for (const count of rowCounts(cells.length, bestGrid(cells.length, width, height).rows)) {
    const rowHeight = height * count / cells.length;
    for (let i = 0; i < count; i += 1) {
      regions.push({
        x: x + width * i / count,
        y: cy,
        width: width / count,
        height: rowHeight,
      });
    }
    cy += rowHeight;
  }
  return regions;
}

// An item's sections as a full, ordered partition of its cells (1-based,
// inclusive). Out-of-range and overlapping input is clamped or dropped, and
// cells no section claims fall into unlabelled sections, so layout never
// loses a cell. Null when the item has none.
export function resolveSections(item) {
  const n = item.cells.length;
  const input = Array.isArray(item.sections) ? item.sections : [];
  const valid = input
    .map((section) => ({
      label: String(section?.label ?? section?.name ?? ''),
      shortLabel: section?.shortLabel != null ? String(section.shortLabel) : null,
      start: Math.max(1, Math.floor(Number(section?.start))),
      end: Math.min(n, Math.floor(Number(section?.end ?? section?.start))),
    }))
    .filter((section) => Number.isFinite(section.start) && Number.isFinite(section.end) && section.start <= section.end)
    .sort((a, b) => a.start - b.start);
  if (!valid.length) return null;

  const resolved = [];
  let next = 1;
  for (const section of valid) {
    if (section.end < next) continue;
    const start = Math.max(section.start, next);
    if (start > next) resolved.push({ label: '', shortLabel: null, start: next, end: start - 1 });
    resolved.push({ ...section, start });
    next = section.end + 1;
  }
  if (next <= n) resolved.push({ label: '', shortLabel: null, start: next, end: n });
  return resolved;
}

// Cells laid out one section at a time along the item's longer side, inside a
// padded inner rect: the padding leaves room for section labels to sit on the
// sections' borders. `gap` (between sections) and `padding` (around them all)
// are fractions of the item's average cell side. `open` keeps the full padding
// only along the top (see options.sectionFrame). The item's own rect is
// unchanged; both come out of the cells.
function layoutSections(cells, sections, rect, gap, padding, open) {
  const n = cells.length;
  const side = Math.sqrt(rect.width * rect.height / n);
  const cap = 0.2 * Math.min(rect.width, rect.height);
  const pad = Math.min(Math.max(0, padding) * side, cap);
  // An open frame needs the room only along the top, where the labels sit.
  const edge = open ? 0.25 * pad : pad;
  const inner = { x: rect.x + edge, y: rect.y + pad, width: rect.width - 2 * edge, height: rect.height - pad - edge };

  const horizontal = inner.width >= inner.height;
  const length = horizontal ? inner.width : inner.height;
  const gutter = sections.length > 1
    ? Math.min(Math.max(0, gap) * side, length * 0.5 / (sections.length - 1))
    : 0;
  const usable = length - gutter * (sections.length - 1);

  const rects = [];
  const dividers = [];
  const placed = [];
  let pos = 0;
  sections.forEach((section, i) => {
    const count = section.end - section.start + 1;
    const size = usable * count / n;
    const box = horizontal
      ? { x: inner.x + pos, y: inner.y, width: size, height: inner.height }
      : { x: inner.x, y: inner.y + pos, width: inner.width, height: size };
    rects.push(...layoutCells(cells.slice(section.start - 1, section.end), box.x, box.y, box.width, box.height));
    placed.push(box);
    pos += size;
    if (i < sections.length - 1) {
      const mid = pos + gutter / 2;
      dividers.push(horizontal
        ? { x1: inner.x + mid, y1: inner.y, x2: inner.x + mid, y2: inner.y + inner.height }
        : { x1: inner.x, y1: inner.y + mid, x2: inner.x + inner.width, y2: inner.y + mid });
      pos += gutter;
    }
  });
  return { rects, dividers, placed, inner, pad };
}

function boundsOf(rects) {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.width));
  const y2 = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: x2 - x, height: y2 - y };
}

function subtractIntervals(lo, hi, cuts) {
  const pieces = [];
  let cur = lo;
  for (const [a, b] of [...cuts].sort((p, q) => p[0] - q[0])) {
    if (b <= cur + EPS) continue;
    if (a > cur + EPS) pieces.push([cur, Math.min(a, hi)]);
    cur = Math.max(cur, b);
    if (cur >= hi - EPS) break;
  }
  if (cur < hi - EPS) pieces.push([cur, hi]);
  return pieces.filter(([a, b]) => b - a > EPS);
}

function regionOutline(rects) {
  const segments = [];
  for (const rect of rects) {
    const left = rect.x;
    const right = rect.x + rect.width;
    const top = rect.y;
    const bottom = rect.y + rect.height;
    const sides = [
      { at: top, lo: left, hi: right, horizontal: true, meets: (other) => other.y + other.height },
      { at: bottom, lo: left, hi: right, horizontal: true, meets: (other) => other.y },
      { at: left, lo: top, hi: bottom, horizontal: false, meets: (other) => other.x + other.width },
      { at: right, lo: top, hi: bottom, horizontal: false, meets: (other) => other.x },
    ];

    for (const side of sides) {
      const covered = rects
        .filter((other) => other !== rect && near(side.meets(other), side.at))
        .map((other) => (side.horizontal ? [other.x, other.x + other.width] : [other.y, other.y + other.height]));

      for (const [a, b] of subtractIntervals(side.lo, side.hi, covered)) {
        segments.push(side.horizontal
          ? { x1: a, y1: side.at, x2: b, y2: side.at }
          : { x1: side.at, y1: a, x2: side.at, y2: b });
      }
    }
  }
  return segments;
}

function onPerimeter(segment, rect) {
  return segment.y1 === segment.y2
    ? near(segment.y1, rect.y) || near(segment.y1, rect.y + rect.height)
    : near(segment.x1, rect.x) || near(segment.x1, rect.x + rect.width);
}

// options.sections turns item sections on. options.sectionGap (between
// sections) and options.sectionPadding (around them, inside the item) are
// fractions of a cell's side. Off, the layout is unchanged.
export function buildGridmapModel(input, world = DEFAULT_WORLDS.landscape, options = {}) {
  const data = normaliseGridmapData(input);
  const useSections = Boolean(options.sections);
  const sectionGap = Number.isFinite(options.sectionGap) ? options.sectionGap : DEFAULT_SECTION_GAP;
  const sectionPadding = Number.isFinite(options.sectionPadding) ? options.sectionPadding : DEFAULT_SECTION_PADDING;
  const openFrame = options.sectionFrame === 'open';
  const totalCells = data.layers.reduce((sum, layer) =>
    sum + itemsOf(layer).reduce((itemSum, item) => itemSum + cellCount(item), 0), 0);
  const usableHeight = world.height - world.gutter * (data.layers.length - 1);

  const model = { data, world: { ...world }, layers: [], groups: [], items: [], sections: [], cells: [] };
  let layerY = world.y;

  data.layers.forEach((layerInput, layerIndex) => {
    const sourceItems = itemsOf(layerInput).map((item) => ({ ...item, n: item.cells.length }));
    const layerRect = {
      x: world.x,
      y: layerY,
      width: world.width,
      height: usableHeight * weightSum(sourceItems) / totalCells,
    };
    const layer = {
      index: layerIndex,
      id: layerInput.id,
      label: layerInput.label,
      meta: layerInput.meta,
      ...layerRect,
      groups: [],
      items: [],
    };
    model.layers.push(layer);

    for (const region of partitionItems(sourceItems, layerRect).regions) {
      const { id, label, shortLabel, cells, groupId, groupLabel, groupMeta, meta, rect } = region;
      const sectionInputs = useSections ? resolveSections(region) : null;
      const item = {
        index: model.items.length,
        id,
        label,
        shortLabel,
        meta,
        layerId: layer.id,
        layerLabel: layer.label,
        layerIndex: layer.index,
        groupId,
        groupLabel,
        groupIndex: -1,
        cellCount: cells.length,
        ...rect,
        cells: [],
        sections: [],
        dividers: [],
        // the inner rect the sections fill, and the padding around it
        inner: null,
        sectionPadding: 0,
        openFrame: false,
      };

      let cellRects;
      if (sectionInputs) {
        const laid = layoutSections(cells, sectionInputs, rect, sectionGap, sectionPadding, openFrame);
        cellRects = laid.rects;
        item.dividers = laid.dividers;
        item.inner = laid.inner;
        item.sectionPadding = laid.pad;
        item.openFrame = openFrame;
        sectionInputs.forEach((input, i) => {
          const section = {
            index: model.sections.length,
            uid: `${item.id}/${i + 1}`,
            label: input.label,
            shortLabel: input.shortLabel,
            start: input.start,
            end: input.end,
            itemId: item.id,
            itemIndex: item.index,
            layerIndex: layer.index,
            cellCount: input.end - input.start + 1,
            ...laid.placed[i],
          };
          item.sections.push(section);
          model.sections.push(section);
        });
      } else {
        cellRects = layoutCells(cells, rect.x, rect.y, rect.width, rect.height);
      }

      cellRects.forEach((cellRect, cellIndex) => {
        const source = cells[cellIndex];
        const section = item.sections.find((s) => cellIndex + 1 >= s.start && cellIndex + 1 <= s.end);
        const cell = {
          index: model.cells.length,
          id: source.id,
          label: source.label,
          value: source.value,
          meta: source.meta,
          layerId: layer.id,
          layerLabel: layer.label,
          layerIndex: layer.index,
          groupId,
          groupLabel,
          groupIndex: -1,
          itemId: item.id,
          itemLabel: item.label,
          itemShortLabel: item.shortLabel,
          itemIndex: item.index,
          ordinal: cellIndex + 1,
          sectionIndex: section ? section.index : -1,
          ...cellRect,
          centerX: cellRect.x + cellRect.width / 2,
          centerY: cellRect.y + cellRect.height / 2,
        };
        item.cells.push(cell);
        model.cells.push(cell);
      });

      layer.items.push(item);
      model.items.push(item);
    }

    for (const groupInput of layerInput.groups) {
      const items = layer.items.filter((item) => item.groupId === groupInput.id);
      const group = {
        index: model.groups.length,
        uid: `${layer.id}/${groupInput.id}`,
        id: groupInput.id,
        label: groupInput.label,
        meta: groupInput.meta ?? {},
        layerId: layer.id,
        layerLabel: layer.label,
        layerIndex: layer.index,
        items,
        bounds: boundsOf(items),
      };
      group.outline = regionOutline(items).map((segment) => ({
        ...segment,
        betweenGroups: !onPerimeter(segment, layer),
      }));
      for (const item of items) {
        item.groupIndex = group.index;
        for (const cell of item.cells) cell.groupIndex = group.index;
      }
      layer.groups.push(group);
      model.groups.push(group);
    }

    layerY += layer.height + world.gutter;
  });

  const firstCell = model.cells[0];
  model.cellSide = firstCell ? Math.sqrt(firstCell.width * firstCell.height) : 1;
  return model;
}

// The smallest set of rectangles covering a set of cells: a whole item where
// every one of its cells is in the set, otherwise the cells alone. Also says
// which items and layers are covered entirely, so their labels can follow.
export function coverCells(model, ids) {
  const cover = { rects: [], items: new Set(), layers: new Set() };
  if (!model || !ids?.size) return cover;
  for (const item of model.items) {
    const covered = item.cells.filter((cell) => ids.has(cell.id));
    if (covered.length && covered.length === item.cells.length) {
      cover.rects.push(item);
      cover.items.add(item.index);
    } else {
      cover.rects.push(...covered);
    }
  }
  for (const layer of model.layers) {
    if (layer.items.length && layer.items.every((item) => cover.items.has(item.index))) cover.layers.add(layer.index);
  }
  return cover;
}

export function cellAt(model, x, y) {
  if (!model) return null;
  for (const item of model.items) {
    if (x < item.x || x >= item.x + item.width || y < item.y || y >= item.y + item.height) continue;
    for (const cell of item.cells) {
      if (x >= cell.x && x < cell.x + cell.width && y >= cell.y && y < cell.y + cell.height) return cell;
    }
  }
  return null;
}

export function validateGridmapModel(model) {
  const itemCells = model.items.reduce((sum, item) => sum + item.cells.length, 0);
  if (itemCells !== model.cells.length) throw new Error('model cell count does not match item cell total');
  if (model.groups.flatMap((group) => group.items).length !== model.items.length) {
    throw new Error('each item must belong to exactly one group');
  }
  if (!model.cells.every((cell) => model.items[cell.itemIndex]?.cells.includes(cell))) {
    throw new Error('each cell must belong to exactly one item');
  }
  for (const item of model.items) {
    if (!item.sections.length) continue;
    const claimed = item.sections.reduce((sum, section) => sum + section.cellCount, 0);
    if (claimed !== item.cells.length) throw new Error('item sections must cover each cell exactly once');
    if (!item.cells.every((cell) => model.sections[cell.sectionIndex]?.itemIndex === item.index)) {
      throw new Error('each cell must belong to a section of its own item');
    }
  }
  return true;
}
