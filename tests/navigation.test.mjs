import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Gridmap, buildGridmapModel, fitWorld } from '../src/index.js';
import { parentFocus, rebindFocus, resolveFocus } from '../src/navigation.js';
import { anchoredBoundaryLabelPosition, boundaryLabelAnchor, boundaryLabelPosition } from '../src/labels.js';
import { bibleToGridmapData } from '../demo/adapters/bible-gridmap-adapter.js';
import { inspectionDetails, inspectionFromHash, inspectionHash, inspectionPath } from '../demo/inspection.js';

const json = (name) => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url)));
const data = bibleToGridmapData(json('bible.json'), json('groups.json'));
const model = buildGridmapModel(data, fitWorld(1.6), { sections: true });
const chapter = model.cells.find((cell) => cell.id === 'GEN/12');

function mapFixture() {
  return Object.assign(Object.create(Gridmap.prototype), {
    model, camera: {}, root: { style: {} }, options: {},
    state: { selected: model.cells.at(-1), hover: null, focus: { level: 'map' } },
    cameraForFocus: () => ({ k: 1, cx: 0, cy: 0 }),
    toWorldX: (x) => x, toWorldY: (y) => y,
    showTooltip() {}, emit() {}, render() {},
  });
}

test('every semantic level steps to its immediate parent and retains the selected chapter', () => {
  const map = mapFixture(), selected = map.state.selected;
  assert.equal(map.focusCell(chapter.id), true);
  const levels = [], hashes = [];
  for (let i = 0; i < 6; i++) {
    const focus = map.getFocus();
    levels.push(focus.level); hashes.push(inspectionHash(focus));
    assert.equal(map.state.selected, selected);
    map.focusParent();
  }
  assert.deepEqual(levels, ['cell', 'section', 'item', 'group', 'layer', 'map']);
  assert.deepEqual(hashes, ['GEN.12', 'GEN/group/12-36', 'GEN', 'the-law', 'old', '']);
  const plain = buildGridmapModel({ layers: [{ items: [{ id: 'plain', cellCount: 2 }] }] });
  const filler = resolveFocus(plain, 'cell', plain.cells[0]);
  assert.equal(parentFocus(plain, filler).level, 'item');
});

test('testament and internal-group focus constrain interaction to their actual membership', () => {
  const map = mapFixture();
  map.focusSection(chapter.sectionIndex);
  assert.equal(map.hitTest(chapter.centerX, chapter.centerY), chapter);
  const outside = model.cells.find((cell) => cell.id === 'GEN/1');
  assert.equal(map.hitTest(outside.centerX, outside.centerY), null);
  map.focusLayer('old');
  assert.equal(map.hitTest(outside.centerX, outside.centerY), outside);
  const nt = model.cells.find((cell) => cell.id === 'MAT/1');
  assert.equal(map.hitTest(nt.centerX, nt.centerY), null);
  const focus = map.getFocus();
  assert.equal(map.focusSection('missing'), false);
  assert.equal(map.getFocus(), focus);
  assert.equal(resolveFocus(model, 'section', undefined), null);
});

test('inspection exposes actual counts, ranges and verse data, with round-trip deep links', () => {
  let focus = resolveFocus(model, 'cell', chapter.id);
  assert.deepEqual(inspectionPath(focus).map((entry) => entry.level), ['layer', 'group', 'item', 'section', 'cell']);
  assert.equal(inspectionDetails(model, focus), '20 verses');
  assert.equal(inspectionDetails(model, parentFocus(model, focus)), 'Chapters 12–36');
  assert.equal(inspectionDetails(model, resolveFocus(model, 'item', 'GEN')), '50 chapters · 3 groups');
  assert.equal(inspectionDetails(model, resolveFocus(model, 'layer', 'old')), '39 books · 929 chapters');
  assert.equal(inspectionDetails(model, { level: 'map' }), '66 books · 1,189 chapters');
  while (true) {
    const parsed = inspectionFromHash(model, inspectionHash(focus));
    assert.equal(inspectionHash(parsed), inspectionHash(focus));
    assert.equal(parsed.level, focus.level);
    if (focus.level === 'map') break;
    focus = parentFocus(model, focus);
  }
  assert.equal(inspectionFromHash(model, 'GEN/group/999-1000').level, 'item');
  assert.equal(inspectionFromHash(model, 'GEN.9999'), null);
});

test('responsive rebuilding preserves semantic identity and falls back when groups are disabled', () => {
  const focus = resolveFocus(model, 'section', chapter.sectionIndex);
  const portrait = buildGridmapModel(data, fitWorld(0.5), { sections: true });
  const rebound = rebindFocus(portrait, focus);
  assert.equal(rebound.level, 'section');
  assert.equal(rebound.section.uid, focus.section.uid);
  assert.notEqual(rebound.section, focus.section);
  const plain = buildGridmapModel(data, fitWorld(0.5));
  const fallback = rebindFocus(plain, focus);
  assert.equal(fallback.level, 'item');
  assert.equal(fallback.item.id, 'GEN');
});

test('division captions use only visible free boundary space and yield to other labels', () => {
  const edges = [{ x1: 0, y1: 30, x2: 200, y2: 30 }];
  const occupied = [{ x: 6, y: 22, width: 55, height: 16 }, { x: 150, y: 22, width: 40, height: 16 }];
  const box = boundaryLabelPosition(edges, 60, 16, occupied, { w: 200, h: 100 });
  assert.ok(box);
  assert.ok(box.x >= 65 && box.x + box.width <= 146);
  assert.equal(boundaryLabelPosition(edges, 90, 16, occupied, { w: 200, h: 100 }), null);
  assert.equal(boundaryLabelPosition([{ x1: 0, y1: 2, x2: 200, y2: 2 }], 60, 16, [], { w: 200, h: 100 }), null);
});

test('division captions hide at their preferred anchor instead of moving to another edge', () => {
  const viewport = { w: 300, h: 200 };
  const edges = [{ x1: 0, y1: 30, x2: 250, y2: 30 }, { x1: 0, y1: 150, x2: 200, y2: 150 }];
  const anchor = boundaryLabelAnchor(edges, 60, 16, [], viewport);
  const original = anchoredBoundaryLabelPosition(anchor, 60, 16, [], viewport);
  assert.equal(anchor.y, 30);
  assert.ok(original);
  const blocker = { ...original };
  assert.equal(anchoredBoundaryLabelPosition(anchor, 60, 16, [blocker], viewport), null);
  assert.equal(boundaryLabelPosition(edges, 60, 16, [blocker], viewport).y, 142);
  assert.equal(anchoredBoundaryLabelPosition({ ...anchor, x: -5 }, 60, 16, [], viewport), null);
  assert.deepEqual(anchoredBoundaryLabelPosition(anchor, 60, 16, [], viewport), original);
});

test('captions too narrow at overview retain a boundary anchor for closer exploration', () => {
  const viewport = { w: 300, h: 200 };
  const anchor = boundaryLabelAnchor([{ x1: 30, y1: 40, x2: 70, y2: 40 }], 60, 16, [], viewport);
  assert.ok(anchor);
  assert.equal(anchoredBoundaryLabelPosition(anchor, 60, 16, [], viewport), null);
  const projected = { x: anchor.x * 3, y: anchor.y * 3, left: anchor.left * 3, right: anchor.right * 3 };
  const box = anchoredBoundaryLabelPosition(projected, 60, 16, [], viewport);
  assert.equal(box.x + box.width / 2, anchor.x * 3);
  assert.equal(box.y + box.height / 2, anchor.y * 3);
});

test('division anchors use neutral geometry and remain cached through camera and attention changes', () => {
  const map = mapFixture();
  Object.assign(map, {
    divisionLabelAnchors: new WeakMap(), borderSegments: {},
    options: { layout: 'fit', labels: {} },
    viewport: () => ({ w: 1000, h: 700 }),
    frame: () => ({ cx: model.world.x + model.world.width / 2, cy: model.world.y + model.world.height / 2, k: 1 }),
  });
  const measure = (text, size) => text.length * size * 0.5;
  const sizes = { item: 11, number: 9 };
  const anchors = map.divisionAnchors(measure, sizes, 15);
  assert.equal(anchors.size, model.groups.length);
  map.camera = { k: 5, cx: 100, cy: 200 };
  map.state.hover = chapter;
  map.state.focus = resolveFocus(model, 'cell', chapter.id);
  map.frame = () => { throw new Error('cached anchors must not be recalculated'); };
  assert.equal(map.divisionAnchors(measure, sizes, 15), anchors);
});
