'use strict';

export const DEFAULT_WORLDS = {
  portrait: { x: 0, y: 0, width: 1000, height: 1900, gutter: 30 },
  landscape: { x: 0, y: 0, width: 1600, height: 1000, gutter: 30 },
};

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

export function buildGridmapModel(input, world = DEFAULT_WORLDS.landscape) {
  const data = normaliseGridmapData(input);
  const totalCells = data.layers.reduce((sum, layer) =>
    sum + itemsOf(layer).reduce((itemSum, item) => itemSum + cellCount(item), 0), 0);
  const usableHeight = world.height - world.gutter * (data.layers.length - 1);

  const model = { data, world: { ...world }, layers: [], groups: [], items: [], cells: [] };
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
      };

      layoutCells(cells, rect.x, rect.y, rect.width, rect.height).forEach((cellRect, cellIndex) => {
        const source = cells[cellIndex];
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
  return true;
}
