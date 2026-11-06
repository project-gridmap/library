import assert from 'node:assert/strict';
import test from 'node:test';
import { markerAttention, resolveAttention, sectionBorderParts } from '../src/attention.js';
import { mergeSegments } from '../src/lines.js';
import { buildGridmapModel } from '../src/model.js';
import { Gridmap } from '../src/gridmap.js';

const data = { layers: [{ id: 'atlas', groups: [{ id: 'division', items: [
  { id: 'first', cellCount: 12, sections: [{ label: 'A', start: 1, end: 4 }, { label: 'B', start: 5, end: 8 }, { label: 'C', start: 9, end: 12 }] },
  { id: 'second', cellCount: 4 },
] }] }] };

test('attention follows one chapter chain while retaining explicit focus context', () => {
  const model = buildGridmapModel(data, undefined, { sections: true });
  const book = model.items[0], other = model.items[1];
  const selection = other.cells[0];
  const focus = { level: 'item', item: book };
  const first = resolveAttention(model, focus, book.cells[0]);
  const adjacent = resolveAttention(model, focus, book.cells[1]);
  assert.deepEqual(first.items, adjacent.items);
  assert.equal(first.section, adjacent.section);
  assert.equal(markerAttention(book.cells[1], first), 1);
  assert.equal(markerAttention(book.cells[5], first), 0.35);
  assert.equal(markerAttention(selection, first), 0);
  const nextGroup = resolveAttention(model, focus, book.cells[5]);
  assert.deepEqual(nextGroup.items, first.items);
  assert.notEqual(nextGroup.section, first.section);
  assert.deepEqual(nextGroup.focused, first.focused);
  const persistent = resolveAttention(model, focus);
  assert.deepEqual([...persistent.items], [book.index]);
  assert.equal(persistent.section, null);
  const chapter = resolveAttention(model, { level: 'cell', cell: book.cells[5], item: book });
  assert.equal(chapter.cell, book.cells[5]);
  assert.equal(chapter.section, model.sections[book.cells[5].sectionIndex]);
  assert.equal(chapter.focusedSection, chapter.section.index);
  const division = resolveAttention(model, { level: 'group', group: model.groups[0] });
  assert.deepEqual([...division.items], [book.index, other.index]);
  const whole = resolveAttention(model);
  assert.equal(whole.focused, null);
  assert.equal(whole.items.size, 0);
});

test('group emphasis partitions existing lines without adding or duplicating boundaries', () => {
  const canonical = (lines) => mergeSegments(lines).map((edge) => JSON.stringify(edge)).sort();
  const length = (lines) => lines.reduce((total, s) => total + Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1), 0);
  for (const world of [{ width: 240, height: 80 }, { width: 80, height: 240 }]) {
    for (const sectionFrame of ['box', 'open']) {
      for (const sectionGap of [0, 0.3]) {
        const model = buildGridmapModel(data, { x: 0, y: 0, gutter: 0, ...world }, { sections: true, sectionFrame, sectionGap });
        const book = model.items[0];
        const baseline = sectionBorderParts(book, null).resting;
        for (const section of book.sections) {
          const { resting, active } = sectionBorderParts(book, section);
          assert.ok(active.length > 0);
          assert.deepEqual(canonical([...resting, ...active]), canonical(baseline));
          assert.ok(Math.abs(length(resting) + length(active) - length(baseline)) < 1e-6);
        }
      }
    }
  }
});

test('changing explicit focus clears transient inspection without changing selection', () => {
  const model = buildGridmapModel(data, undefined, { sections: true });
  const selected = model.items[1].cells[0];
  const map = Object.assign(Object.create(Gridmap.prototype), {
    model, camera: {}, root: { style: {} },
    state: { selected, hover: selected, focus: { level: 'map' } },
    pressedCell: selected,
    cameraForFocus: () => ({ k: 1, cx: 0, cy: 0 }),
    showTooltip() {}, emit() {}, render() {},
  });
  for (const [level, value] of [['item', 'first'], ['group', 'division'], ['cell', model.cells[0].id]]) {
    assert.equal(map.setFocus(level, value), true);
    assert.equal(map.state.selected, selected);
    assert.equal(map.state.hover, null);
    assert.equal(map.pressedCell, null);
    assert.equal(map.attentionState().cell, level === 'cell' ? model.cells[0] : null);
  }
});
