import assert from 'node:assert/strict';
import test from 'node:test';
import { Gridmap } from '../src/gridmap.js';

function fixture() {
  const cells = [10, 40].map((value, index) => ({
    id: `book/${index + 1}`, label: String(index + 1), value,
    width: 12, height: 12, centerX: index * 12 + 6, centerY: 6,
  }));
  const map = Object.assign(Object.create(Gridmap.prototype), {
    options: {
      theme: { text: '#ffffff', selectedMark: '#05060a', font: 'monospace' },
      colourParts: { marks: { coloured: false, opacity: 0.28 } },
      colours: {}, markOpacity: 0.75, dotTint: 0,
      relativeMarkSize: true, markMaxSize: 0.4,
    },
    model: { world: {}, items: [{ id: 'book', cells }] },
    state: { hover: null, selected: null }, disabled: new Set(),
    camera: { k: 1, cx: 0, cy: 0 }, medianValue: 10, referenceValue: 40, medianNumberSize: 1,
    frame: () => ({ k: 1 }), useNumbers: () => false,
  });
  const draws = [], stack = [];
  const ctx = {
    beginPath() { this.path = []; },
    arc(x, y, radius) { this.path.push({ x, y, radius }); },
    fill() { draws.push({ kind: 'fill', path: [...this.path], alpha: this.globalAlpha, colour: this.fillStyle }); },
    stroke() { draws.push({ kind: 'stroke', path: [...this.path], width: this.lineWidth, glow: this.shadowBlur }); },
    fillText(text) { draws.push({ kind: 'text', text, alpha: this.globalAlpha, colour: this.fillStyle }); },
    save() { stack.push({ globalAlpha: this.globalAlpha }); },
    restore() { Object.assign(this, stack.pop()); },
    setLineDash() {},
  };
  const paint = () => {
    draws.length = 0;
    map.renderMarks(ctx, (x) => x, (y) => y, () => true);
    return [...draws];
  };
  return { map, cells, paint };
}

test('dot emphasis preserves verse-sized cores, omits crowded outlines, and leaves numbers unchanged', () => {
  const { map, cells, paint } = fixture();
  const resting = paint();
  assert.deepEqual(resting.map((draw) => draw.path[0].radius), [1.5, 3]);
  assert.ok(Math.abs(resting[0].alpha - 0.34) < 1e-9);
  map.state.hover = cells[0];
  const hovered = paint();
  assert.deepEqual(hovered.filter((draw) => draw.kind === 'fill').map((draw) => draw.path[0].radius), [1.5, 3]);
  assert.equal(hovered[0].alpha, 0.7);
  assert.equal(hovered.find((draw) => draw.kind === 'stroke').width, 0.75);
  assert.equal(hovered.find((draw) => draw.kind === 'stroke').glow, 0);
  cells[0].width = 5;
  assert.ok(paint().every((draw) => draw.kind !== 'stroke'));
  map.useNumbers = () => true;
  map.state.hover = null;
  const numbers = paint();
  assert.ok(numbers.every((draw) => draw.kind === 'text' && draw.alpha === 0.28 && draw.colour === '#ffffff'));
  cells[0].width = 12;
  map.state.selected = cells[0];
  assert.equal(paint()[0].colour, '#05060a');
});

test('touch press emphasis clears for panning while taps still select', () => {
  const { map, cells } = fixture();
  Object.assign(map, {
    pointers: new Map(), root: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
    hitTest: () => cells[0], toWorldX: (x) => x, toWorldY: (y) => y, requestRender() {}, showTooltip() {}, setCamera() {},
    selectCell(cell) { this.state.selected = cell; },
  });
  const event = (x) => ({ pointerType: 'touch', pointerId: 1, clientX: x, clientY: 6 });
  map.onPointerDown(event(6));
  assert.equal(map.activeMarker(), cells[0]);
  map.onPointerMove(event(20));
  assert.equal(map.pressedCell, null);
  assert.equal(map.activeMarker(), null);
  map.onPointerUp(event(20));
  assert.equal(map.state.selected, null);
  map.onPointerDown(event(6));
  map.onPointerUp(event(6));
  assert.equal(map.pressedCell, null);
  assert.equal(map.state.selected, cells[0]);
  map.state.selected = null;
  map.onPointerDown(event(6));
  map.onPointerCancel(event(6));
  assert.equal(map.pressedCell, null);
  assert.equal(map.state.selected, null);
  map.onPointerDown(event(6));
  map.onPointerDown({ ...event(10), pointerId: 2 });
  assert.equal(map.pressedCell, null);
  assert.equal(map.activeMarker(), null);
  map.onPointerCancel({ ...event(10), pointerId: 2 });
  map.onPointerCancel(event(6));
  assert.equal(map.state.selected, null);
});
