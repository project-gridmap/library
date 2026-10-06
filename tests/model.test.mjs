import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGridmapModel,
  cellAt,
  coverCells,
  DEFAULT_FIT_RATIOS,
  fitWorld,
  normaliseGridmapData,
  pickFitRatio,
  validateGridmapModel,
} from '../src/index.js';

const data = {
  layers: [
    {
      id: 'alpha',
      label: 'Alpha',
      groups: [
        {
          id: 'first',
          label: 'First',
          items: [
            { id: 'a', label: 'A', cells: [{ id: 'a.1', label: '1', value: 10 }, { id: 'a.2', label: '2', value: 20 }] },
            { id: 'b', label: 'B', cells: [{ id: 'b.1', label: '1', value: 5 }] },
          ],
        },
      ],
    },
    {
      id: 'beta',
      label: 'Beta',
      groups: [
        {
          id: 'second',
          label: 'Second',
          items: [
            { id: 'c', label: 'C', cells: [{ id: 'c.1', label: '1' }, { id: 'c.2', label: '2' }, { id: 'c.3', label: '3' }] },
          ],
        },
      ],
    },
  ],
};

test('normalises generic shorthand without domain terminology', () => {
  const normalised = normaliseGridmapData({
    layers: [{ id: 'one', label: 'One', items: [{ id: 'item', label: 'Item', cells: [1, 2] }] }],
  });

  assert.equal(normalised.layers[0].groups[0].id, 'default');
  assert.equal(normalised.layers[0].groups[0].items[0].cells[1].id, '2');
});

test('builds a deterministic content-agnostic model', () => {
  const model = buildGridmapModel(data, { x: 0, y: 0, width: 600, height: 400, gutter: 20 });

  assert.equal(model.layers.length, 2);
  assert.equal(model.groups.length, 2);
  assert.equal(model.items.length, 3);
  assert.equal(model.cells.length, 6);
  assert.equal(model.cells.map((cell) => cell.id).join(','), 'a.1,a.2,b.1,c.1,c.2,c.3');
  assert.equal(validateGridmapModel(model), true);
});

test('locates a cell from world coordinates', () => {
  const model = buildGridmapModel(data, { x: 0, y: 0, width: 600, height: 400, gutter: 20 });
  const expected = model.cells.find((cell) => cell.id === 'c.2');
  const actual = cellAt(model, expected.centerX, expected.centerY);

  assert.equal(actual.id, 'c.2');
});

test('covers whole items and layers where every cell is included', () => {
  const model = buildGridmapModel(data, { x: 0, y: 0, width: 600, height: 400, gutter: 20 });
  const cover = coverCells(model, new Set(['a.1', 'c.1', 'c.2', 'c.3']));

  assert.deepEqual(cover.rects.map((rect) => rect.id), ['a.1', 'c']);
  assert.deepEqual([...cover.items], [model.items.find((item) => item.id === 'c').index]);
  assert.deepEqual([...cover.layers], [model.layers.find((layer) => layer.id === 'beta').index]);
  assert.equal(coverCells(model, new Set()).rects.length, 0);
});

test('picks the fit ratio nearest the aspect', () => {
  assert.equal(pickFitRatio(0.9), 0.85);
  assert.equal(pickFitRatio(0.52), 0.5);
  assert.equal(pickFitRatio(3), 1.6);
  assert.equal(pickFitRatio(0.7, [0.55, 1.3]), 0.55);
  assert.equal(pickFitRatio(0.9, []), 0.85);
  assert.equal(pickFitRatio(Number.NaN), 1);
});

test('keeps the current fit ratio through small resizes', () => {
  // 0.92 is a little nearer 1 than 0.85, but not enough to switch
  assert.equal(pickFitRatio(0.93, DEFAULT_FIT_RATIOS, 0.85), 0.85);
  assert.equal(pickFitRatio(0.93, DEFAULT_FIT_RATIOS, null), 1);
  // well past the midpoint, it does switch
  assert.equal(pickFitRatio(1.0, DEFAULT_FIT_RATIOS, 0.85), 1);
  // a current ratio no longer on offer is dropped
  assert.equal(pickFitRatio(0.93, [1, 1.6], 0.85), 1);
});

test('builds a valid model filling every fit world', () => {
  for (const ratio of DEFAULT_FIT_RATIOS) {
    const world = fitWorld(ratio);
    const model = buildGridmapModel(data, world);
    assert.equal(validateGridmapModel(model), true);
    assert.ok(Math.abs(world.width / world.height - ratio) < 1e-9);
    const bottom = Math.max(...model.cells.map((cell) => cell.y + cell.height));
    const right = Math.max(...model.cells.map((cell) => cell.x + cell.width));
    assert.ok(Math.abs(bottom - world.height) < 1e-6);
    assert.ok(Math.abs(right - world.width) < 1e-6);
  }
});

const sectioned = (cellCount, sections) => ({
  layers: [{
    id: 'l',
    label: 'L',
    groups: [{ id: 'g', label: 'G', items: [{ id: 'book', label: 'Book', cellCount, sections }] }],
  }],
});

test('sections are off by default and leave the layout unchanged', () => {
  const input = sectioned(12, [{ label: 'One', start: 1, end: 5 }, { label: 'Two', start: 6, end: 12 }]);
  const plain = buildGridmapModel(sectioned(12));
  const off = buildGridmapModel(input);
  assert.deepEqual(off.cells.map(({ x, y, width, height }) => [x, y, width, height]),
    plain.cells.map(({ x, y, width, height }) => [x, y, width, height]));
  assert.equal(off.sections.length, 0);
});

test('sections partition an item with gaps and dividers', () => {
  const model = buildGridmapModel(
    sectioned(12, [{ label: 'One', start: 1, end: 5 }, { label: 'Two', start: 6, end: 12 }]),
    fitWorld(1),
    { sections: true, sectionGap: 0.35 },
  );
  assert.equal(validateGridmapModel(model), true);
  const [one, two] = model.sections;
  assert.deepEqual([one.cellCount, two.cellCount], [5, 7]);
  assert.equal(model.items[0].dividers.length, 1);
  assert.equal(model.cells.filter((cell) => cell.sectionIndex === one.index).length, 5);
  const item = model.items[0];
  for (const cell of model.cells) {
    assert.ok(cell.x >= item.x - 1e-6 && cell.x + cell.width <= item.x + item.width + 1e-6);
    assert.ok(cell.y >= item.y - 1e-6 && cell.y + cell.height <= item.y + item.height + 1e-6);
  }
  const apart = one.width > one.height
    ? two.y - (one.y + one.height)
    : two.x - (one.x + one.width);
  assert.ok(apart > 0, 'sections are separated by a gap');
  const mid = model.cells[0];
  assert.equal(cellAt(model, mid.centerX, mid.centerY), mid);
});

test('sections tolerate gaps, overlaps and out-of-range input', () => {
  const model = buildGridmapModel(
    sectioned(10, [
      { label: 'B', start: 4, end: 6 },
      { label: 'A', start: 2, end: 4 },
      { label: 'Z', start: 9, end: 40 },
      { label: 'bad', start: 'x', end: 3 },
    ]),
    fitWorld(1),
    { sections: true },
  );
  assert.equal(validateGridmapModel(model), true);
  assert.deepEqual(model.sections.map((s) => [s.label, s.start, s.end]), [
    ['', 1, 1], ['A', 2, 4], ['B', 5, 6], ['', 7, 8], ['Z', 9, 10],
  ]);
});

test('sections touch by default and sit inside the item padding', () => {
  const model = buildGridmapModel(
    sectioned(12, [{ label: 'One', start: 1, end: 5 }, { label: 'Two', start: 6, end: 12 }]),
    fitWorld(1),
    { sections: true },
  );
  const [one, two] = model.sections;
  const item = model.items[0];
  const apart = one.width > one.height ? two.y - (one.y + one.height) : two.x - (one.x + one.width);
  assert.ok(Math.abs(apart) < 1e-6, 'sections touch');
  assert.ok(item.sectionPadding > 0);
  assert.ok(Math.abs(one.x - (item.x + item.sectionPadding)) < 1e-6);
  assert.ok(Math.abs(one.y - (item.y + item.sectionPadding)) < 1e-6);
  assert.ok(Math.abs(item.inner.width - (item.width - 2 * item.sectionPadding)) < 1e-6);
  const none = buildGridmapModel(sectioned(12, [{ label: 'One', start: 1, end: 12 }]), fitWorld(1), { sections: true, sectionPadding: 0 });
  assert.equal(none.items[0].sectionPadding, 0);
});
