import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGridmapModel,
  cellAt,
  normaliseGridmapData,
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
