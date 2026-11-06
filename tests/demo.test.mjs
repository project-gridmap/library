import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { bibleToGridmapData } from '../demo/adapters/bible-gridmap-adapter.js';
import { bibleGameOptions } from '../demo/bible-game-config.js';
import { buildGridmapModel, cellAt, fitWorld, validateGridmapModel } from '../src/index.js';

const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const bible = json('../bible.json');
const groups = json('../groups.json');
const colours = json('../colours.json');

test('app-configured demo preserves chapter identity and book bounds across grouped fit layouts', () => {
  const data = bibleToGridmapData(bible, groups);
  const options = bibleGameOptions(colours);
  for (const ratio of [0.5, 1, 1.6]) {
    const world = fitWorld(ratio);
    const plain = buildGridmapModel(data, world);
    const grouped = buildGridmapModel(data, world, { sections: options.showSections });
    assert.equal(validateGridmapModel(grouped), true);
    assert.equal(grouped.items.length, 66);
    assert.equal(grouped.cells.length, 1189);
    assert.deepEqual(grouped.cells.map((c) => c.id), plain.cells.map((c) => c.id));
    const rects = (model) => model.items.map(({ x, y, width, height }) => ({ x, y, width, height }));
    assert.deepEqual(rects(grouped), rects(plain));
    assert.ok(grouped.sections.length > 100);
    assert.ok(grouped.items.find((item) => item.id === 'MAT').sections.length > 0);
    for (const cell of grouped.cells) {
      assert.equal(cellAt(grouped, cell.centerX, cell.centerY)?.id, cell.id);
      assert.equal(cell.id, `${cell.meta.bookKey}/${cell.meta.chapter}`);
      assert.ok(options.colours[cell.itemId]);
      assert.ok(options.selectedColours[cell.itemId]);
    }
  }
});
