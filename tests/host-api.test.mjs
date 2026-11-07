import assert from 'node:assert/strict';
import test from 'node:test';
import { Gridmap } from '../src/gridmap.js';

// A map without a DOM: a 100×100 viewport over a 200×100 world of two items in one group.
function fixture() {
  const cells = [0, 1].map((index) => ({
    id: `item-${index}/1`, label: '1', value: 1, itemId: `item-${index}`, itemIndex: index, sectionIndex: -1,
    x: index * 100, y: 0, width: 100, height: 100, centerX: index * 100 + 50, centerY: 50,
  }));
  const items = cells.map((cell, index) => ({ id: cell.itemId, index, cells: [cell], x: cell.x, y: 0, width: 100, height: 100 }));
  const group = { id: 'group', items, bounds: { x: 0, y: 0, width: 200, height: 100 } };
  const map = Object.assign(Object.create(Gridmap.prototype), {
    options: { layout: 'auto', maxCellViewportRatio: 100, theme: {} },
    model: { world: { x: 0, y: 0, width: 200, height: 100 }, items, groups: [group], layers: [], sections: [], cells, cellSide: 1 },
    state: { hover: null, selected: null, focus: { level: 'map' } },
    camera: { cx: 100, cy: 50, k: 0.5, free: false },
    listeners: new Map(), glide: null, destroyed: false,
    root: { style: {} }, viewport: () => ({ w: 100, h: 100 }),
    render() { this.renders = (this.renders ?? 0) + 1; }, requestRender() {}, showTooltip() {},
  });
  const moves = [];
  map.on('cameraChange', (change) => moves.push(change));
  return { map, moves, items };
}

function frames() {
  const queue = new Map();
  let next = 1, now = 0;
  globalThis.requestAnimationFrame = (step) => { queue.set(next, step); return next++; };
  globalThis.cancelAnimationFrame = (id) => queue.delete(id);
  return {
    pending: () => queue.size,
    advance(ms) {
      now += ms;
      const steps = [...queue.values()];
      queue.clear();
      steps.forEach((step) => step(now));
    },
  };
}

test('camera changes report where the camera went and why', () => {
  const { map, moves } = fixture();
  map.placeCamera(120, 50, 1, 'user');
  map.setCamera(120, 50, 1);
  map.setCamera(80, 40, 2);
  map.focusItem('item-1');
  assert.deepEqual(moves.map((move) => move.source), ['user', 'api', 'focus']);
  assert.deepEqual(moves[0].previous, { cx: 100, cy: 50, k: 0.5 });
  assert.equal(moves[2].previous.k, 2);
  assert.deepEqual(map.getCamera(), { cx: moves[2].cx, cy: moves[2].cy, k: moves[2].k });
});

test('glideTo focuses at once, eases the camera and settles where setFocus would', () => {
  const clock = frames();
  const { map, moves } = fixture();
  const focusChanges = [];
  map.on('focusChange', (focus) => focusChanges.push(focus.level));
  assert.equal(map.glideTo('item', 'item-1', { duration: 100 }), true);
  assert.equal(map.getFocus?.().level ?? map.state.focus.level, 'item');
  assert.deepEqual(focusChanges, ['item']);
  assert.equal(map.isGliding(), true);
  clock.advance(0);
  clock.advance(50);
  const halfway = map.getCamera();
  clock.advance(60);
  assert.equal(map.isGliding(), false);
  assert.equal(clock.pending(), 0);

  const jumped = fixture().map;
  jumped.focusItem('item-1');
  assert.deepEqual(map.getCamera(), jumped.getCamera());
  assert.equal(map.camera.free, false);
  assert.ok(halfway.k > 0.5 && halfway.k < jumped.getCamera().k);
  assert.ok(moves.length >= 2 && moves.every((move) => move.source === 'glide'));
});

test('glideTo starts from a given camera, and a user move or a jump stops it', () => {
  const clock = frames();
  const { map, moves } = fixture();
  map.glideTo('item', 'item-0', { duration: 100, from: { cx: 0, cy: 0, k: 0.25 } });
  assert.deepEqual(moves[0], { cx: 0, cy: 0, k: 0.25, previous: { cx: 100, cy: 50, k: 0.5 }, source: 'glide' });
  clock.advance(0);
  map.root.getBoundingClientRect = () => ({ left: 0, top: 0 });
  map.onWheel({ preventDefault() {}, clientX: 0, clientY: 0, deltaY: 0, deltaMode: 0 });
  assert.equal(map.isGliding(), false);
  assert.equal(clock.pending(), 0);

  map.glideTo('map', null, { duration: 100 });
  map.focusItem('item-1');
  assert.equal(map.isGliding(), false);
  assert.equal(clock.pending(), 0);
});

test('glideTo jumps under reduced motion, and refuses an unknown target', () => {
  frames();
  const { map, moves } = fixture();
  globalThis.matchMedia = () => ({ matches: true });
  try {
    assert.equal(map.glideTo('item', 'item-1'), true);
    assert.equal(map.isGliding(), false);
    assert.deepEqual(moves.map((move) => move.source), ['focus']);
  } finally {
    delete globalThis.matchMedia;
  }
  assert.equal(map.glideTo('item', 'nowhere'), false);
});

test('layers can paint above the focus veil, with a mark radius to size by', () => {
  const order = [];
  const { map } = fixture();
  Object.assign(map, {
    ctx: { save() {}, restore() {} }, layers: new Set(), layersAbove: new Set(),
    renderVeil: () => order.push('veil'), medianValue: 1,
  });
  map.render = () => {
    const helpers = { markRadius: (cell) => map.dotSize() * map.markScale(cell) / 2 };
    const paint = (layer) => layer(helpers);
    map.layers.forEach(paint);
    map.renderVeil();
    map.layersAbove.forEach(paint);
  };
  map.addLayer(() => order.push('below'));
  const remove = map.addLayer(({ markRadius }) => order.push(['above', markRadius(map.model.cells[0]) > 0]), { above: true });
  order.length = 0;
  map.render();
  assert.deepEqual(order, ['below', 'veil', ['above', true]]);
  remove();
  order.length = 0;
  map.render();
  assert.deepEqual(order, ['below', 'veil']);
});
