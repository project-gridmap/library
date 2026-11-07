import assert from 'node:assert/strict';
import test from 'node:test';
import { installChapterDestination } from '../demo/chapter-destination.js';

class Element {
  style = {}; children = []; attributes = {}; events = [];
  setAttribute(key, value) { this.attributes[key] = value; }
  appendChild(child) { this.children.push(child); if (typeof child === 'object') child.parent = this; return child; }
  append(...children) { children.forEach((child) => this.appendChild(child)); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type) { this.events.push(type); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
  animate() { return { cancel() {} }; }
  getContext() { return { clearRect() {}, fillRect() {}, getImageData: () => ({ data: [12, 15, 25, 255] }) }; }
}
const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

test('paced loading keeps skeletons during service cooldown and retries automatically', async () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: () => new Element() };
  let painter, dispose, calls = 0;
  const cell = { id: 'RUT/2', itemId: 'RUT', itemLabel: 'Ruth', label: '2', x: 0, y: 0, width: 1, height: 1 };
  const ctx = { save() {}, restore() {}, clearRect() {}, fillRect() {}, measureText: (text) => ({ width: text.length * 8 }) };
  const map = { root: new Element(), model: { cells: [cell] }, state: {},
    viewport: () => ({ w: 400, h: 400 }), isCellDisabled: () => false,
    addLayer(fn) { painter = fn; this.render(); return () => { painter = null; }; },
    render() { painter?.({ ctx, model: this.model, camera: { k: 350, cx: 0, cy: 0 },
      toScreenX: (x) => x * 350, toScreenY: (y) => y * 350,
      colourOf: () => '#9d9fd3', theme: { text: '#eee', font: 'monospace' } }); } };
  try {
    dispose = installChapterDestination(map, { revealContent: true, dwellMs: 1, requestIntervalMs: 100,
      loadChapter: async () => {
        if (++calls === 1) throw Object.assign(new Error('Rate limited'), { retryAfterMs: 100 });
        return { verses: ['The chapter is ready.'] };
      } });
    await wait(30);
    assert.equal(calls, 1);
    const root = map.root.children[0];
    assert.equal(root.children[2].children[0].style.display, 'block');
    assert.equal(root.children[2].children[2].style.display, 'none');
    await wait(120);
    assert.equal(calls, 2);
    assert.equal(root.children[1].style.display, 'block');
  } finally { dispose?.(); globalThis.document = originalDocument; }
});

test('natural prime focus waits before fetching, ignores selection, cancels stale work and preserves navigation', async () => {
  const originalDocument = globalThis.document, originalMedia = globalThis.matchMedia;
  globalThis.document = { createElement: () => new Element() };
  globalThis.matchMedia = () => ({ matches: false });
  const first = { id: 'RUT/2', itemId: 'RUT', itemLabel: 'Ruth', label: '2', x: 0, y: 0, width: 1, height: 1 };
  const second = { ...first, id: 'RUT/3', label: '3', x: 1 };
  const ctx = { save() {}, restore() {}, clearRect() {}, fillRect() {}, measureText: (text) => ({ width: text.length * 8 }) };
  let painter, dispose, offset = 0;
  const calls = [];
  const originalFocus = () => ({ k: 1 }), originalClamp = (k) => k;
  const map = { root: new Element(), state: { selected: null }, model: { cells: [first, second] },
    cameraForFocus: originalFocus, clampK: originalClamp,
    viewport: () => ({ w: 500, h: 500 }), isCellDisabled: () => false,
    addLayer(fn) { painter = fn; this.render(); return () => { painter = null; }; },
    render() { painter?.({ ctx, model: this.model, camera: { k: 400, cx: -offset / 400, cy: 0 },
      toScreenX: (x) => x * 400 + offset, toScreenY: (y) => y * 400,
      colourOf: () => '#9d9fd3', theme: { text: '#eee', font: 'monospace' } }); } };
  const loadChapter = (cell, { signal }) => new Promise((resolve, reject) => calls.push({ cell, signal, resolve, reject }));
  try {
    dispose = installChapterDestination(map, { loadChapter, dwellMs: 10 });
    await wait(20); assert.equal(calls.length, 0); dispose();
    dispose = installChapterDestination(map, { loadChapter, revealContent: true, dwellMs: 10 });
    assert.equal(calls.length, 0, 'passing through a chapter must not fetch immediately');
    assert.equal(map.cameraForFocus, originalFocus); assert.equal(map.clampK, originalClamp);
    let preview = map.root.children.at(-1);
    assert.deepEqual(preview.events, [], 'the preview must not intercept wheel, pinch or selection');
    await wait(20); assert.equal(calls.length, 1);
    assert.equal(calls[0].cell.id, 'RUT/2'); assert.equal(map.state.selected, null);
    offset = -400; map.render();
    assert.equal(calls[0].signal.aborted, true);
    await wait(20); assert.equal(calls.length, 2);
    preview = map.root.children.at(-1);
    calls[0].resolve({ verses: ['Stale text.'] }); await wait();
    assert.equal(preview.attributes['aria-busy'], 'true');
    calls[1].reject(new Error('Network unavailable')); await wait();
    const status = preview.children[2];
    assert.equal(status.children[1].textContent, 'Chapter unavailable.');
    status.children[2].onclick(); await wait(); assert.equal(calls.length, 3);
    calls[2].resolve({ verses: ['Opening verse.', 'Second verse shown.', ...Array(20).fill('More chapter text.'), 'Final verse.'] }); await wait();
    assert.equal(preview.children[0].textContent, 'Ruth 3');
    const body = preview.children[1], footer = preview.children[3];
    assert.equal(body.children[0].children[0].textContent, '1');
    assert.equal(body.children[1].children[0].textContent, '2');
    assert.equal(footer.children.length, 3, 'footer contains only previous, page count and next');
    assert.equal(preview.attributes['aria-busy'], 'false');
    assert.equal(map.state.selected, null);
    const read = (element) => typeof element === 'string' ? element : element.textContent ?? element.children.map(read).join('');
    assert.ok(read(body).includes('Second verse shown.'));
    assert.ok(read(body).endsWith('…'));
    let turns = 0;
    while (!footer.children[2].disabled && turns++ < 50) footer.children[2].onclick();
    assert.ok(turns > 0 && turns < 50);
    assert.ok(read(body).endsWith('Final verse.'), 'the last page preserves the chapter ending');
    status.children[2].onclick(); await wait();
    calls[3].resolve({ verses: ['The only verse.'] }); await wait();
    assert.ok(read(body).endsWith('The only verse.'));
    assert.equal(footer.style.visibility, 'visible');
    assert.equal(footer.children[1].textContent, '1 / 1');
    assert.equal(footer.children[0].disabled, true);
    assert.equal(footer.children[2].disabled, true);
    map.gesture = { moved: true }; map.render();
    assert.equal(preview.style.display, 'block', 'existing readable text remains during gestures');
  } finally {
    dispose?.(); globalThis.document = originalDocument; globalThis.matchMedia = originalMedia;
  }
});

test('only the prime book gets chapter views and requests, with independent page controls', async () => {
  const originalDocument = globalThis.document, originalMedia = globalThis.matchMedia;
  globalThis.document = { createElement: () => new Element() };
  globalThis.matchMedia = () => ({ matches: false });
  let painter, dispose, offset = 0;
  const calls = [];
  const cells = Array.from({ length: 3 }, (_, index) => ({ id: `RUT/${index + 1}`, itemId: 'RUT',
    itemLabel: 'Ruth', label: String(index + 1), x: index, y: 0, width: 1, height: 1 }));
  cells.push(...[3, 4].map((x, index) => ({ ...cells[0], id: `EZR/${index + 1}`,
    itemId: 'EZR', itemLabel: 'Ezra', label: String(index + 1), x })));
  const ctx = { save() {}, restore() {}, clearRect() {}, fillRect() {}, measureText: (text) => ({ width: text.length * 8 }) };
  const map = { root: new Element(), model: { cells }, state: { selected: null }, viewport: () => ({ w: 1050, h: 500 }),
    isCellDisabled: () => false, addLayer(fn) { painter = fn; this.render(); return () => { painter = null; }; },
    render() { painter?.({ ctx, model: this.model, camera: { k: 350, cx: -offset / 350, cy: 0 },
      toScreenX: (x) => x * 350 + offset, toScreenY: (y) => y * 350,
      colourOf: () => '#9d9fd3', theme: { text: '#eee', font: 'monospace' } }); } };
  const loadChapter = (cell) => new Promise((resolve) => calls.push({ cell, resolve }));
  try {
    dispose = installChapterDestination(map, { loadChapter, revealContent: true, dwellMs: 10 });
    await wait(30);
    assert.equal(map.root.children.length, 3, 'every readable cell gets its own view');
    assert.equal(calls.length, 2, 'at most two requests may be in flight');
    assert.equal(calls[0].cell.id, 'RUT/2', 'the most prominent chapter loads first');
    calls[0].resolve({ verses: ['Complete chapter text. '.repeat(100)] }); await wait();
    assert.equal(calls.length, 3);
    calls[1].resolve({ verses: ['Neighbour text. '.repeat(100)] });
    calls[2].resolve({ verses: ['Neighbour text. '.repeat(100)] }); await wait();
    const roots = [...map.root.children];
    assert.ok(roots.every((root) => root.style.display === 'block' && root.children[1].children.length > 0));
    assert.equal(roots.filter((root) => root.children[3].style.visibility === 'visible').length, 3);
    const centre = roots.find((root) => root.attributes['data-chapter-id'] === 'RUT/2');
    centre.children[3].children[2].onclick();
    const position = centre.children[3].children[1].textContent;
    const neighbour = roots.find((root) => root.attributes['data-chapter-id'] === 'RUT/1');
    const initialNeighbourPage = neighbour.children[3].children[1].textContent;
    neighbour.children[3].children[2].onclick();
    assert.notEqual(neighbour.children[3].children[1].textContent, initialNeighbourPage);
    assert.equal(centre.children[3].children[1].textContent, position, 'paging one cell leaves its neighbour in place');
    offset = -4; map.gesture = { moved: true }; map.render();
    assert.ok(roots.every((root) => root.style.display === 'block'), 'small gestures do not hide existing text');
    assert.equal(map.root.children.length, 3);
    assert.equal(calls.length, 3, 'movement does not refetch loaded neighbours');
    assert.equal(centre.children[3].children[1].textContent, position);
    assert.equal(map.state.selected, null);
    map.state.selected = cells[0];
    offset = -700; delete map.gesture; map.render(); await wait(30);
    assert.equal(map.root.children.length, 2, 'visible chapters in the other book keep their original markers');
    assert.ok(map.root.children.every((root) => root.attributes['data-chapter-id'].startsWith('EZR/')));
    assert.equal(calls.length, 5);
    assert.ok(calls.slice(3).every(({ cell }) => cell.itemId === 'EZR'));
    assert.equal(map.state.selected, cells[0], 'prime book follows the viewport independently of selection');
  } finally {
    dispose?.(); globalThis.document = originalDocument; globalThis.matchMedia = originalMedia;
  }
});

test('demo zoom threshold reports overview-relative zoom and updates text admission immediately', async () => {
  const originalDocument = globalThis.document, originalMedia = globalThis.matchMedia;
  globalThis.document = { createElement: () => new Element() };
  globalThis.matchMedia = () => ({ matches: false });
  let painter, dispose, threshold = 5, reported, requests = 0;
  const cell = { id: 'RUT/2', itemId: 'RUT', itemLabel: 'Ruth', label: '2', x: 0, y: 0, width: 1, height: 1 };
  const ctx = { save() {}, restore() {}, clearRect() {}, fillRect() {}, measureText: (text) => ({ width: text.length * 8 }) };
  const map = { root: new Element(), options: { layout: 'fit' }, viewport: () => ({ w: 500, h: 500 }),
    frame: () => ({ k: 100 }), isCellDisabled: () => false,
    addLayer(fn) { painter = fn; this.render(); return () => { painter = null; }; },
    render() { painter?.({ ctx, model: { cells: [cell], world: {} }, camera: { k: 400, cx: 0, cy: 0 },
      toScreenX: (x) => x * 400, toScreenY: (y) => y * 400,
      colourOf: () => '#9d9fd3', theme: { text: '#eee', font: 'monospace' } }); } };
  try {
    dispose = installChapterDestination(map, { revealContent: true, dwellMs: 10,
      getRevealZoom: () => threshold, onZoom: (value) => { reported = value; },
      loadChapter: async () => { requests++; return { verses: ['Chapter text.'] }; } });
    await wait(20);
    assert.equal(reported, 4); assert.equal(requests, 0); assert.equal(map.root.children.length, 0, 'no early skeleton below the configured threshold');
    threshold = 3; map.render(); await wait(20);
    assert.equal(requests, 1); assert.equal(map.root.children.length, 1);
    threshold = 4.1; map.render();
    assert.equal(map.root.children.length, 0, 'raising the threshold removes the reading layer until entry');
    threshold = 0; map.render(); await wait(20);
    assert.equal(map.root.children.length, 1, 'zero restores automatic readable-space disclosure');
  } finally {
    dispose?.(); globalThis.document = originalDocument; globalThis.matchMedia = originalMedia;
  }
});

test('skeletons and fetching enter at 15×, then compact text scales without the old readability gate', async () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: () => new Element() };
  let painter, dispose, zoom = 14.9, requests = 0, resolve;
  const cell = { id: 'RUT/2', itemId: 'RUT', itemLabel: 'Ruth', label: '2', x: 0, y: 0, width: 8, height: 16 };
  const ctx = { save() {}, restore() {}, clearRect() {}, fillRect() {}, measureText(text) {
    const size = Number(/([\d.]+)px/.exec(this.font)?.[1] ?? 15); return { width: text.length * size * 0.6 };
  } };
  const map = { root: new Element(), options: { layout: 'fit' }, viewport: () => ({ w: 500, h: 500 }),
    frame: () => ({ k: 1 }), isCellDisabled: () => false,
    addLayer(fn) { painter = fn; this.render(); return () => { painter = null; }; },
    render() { painter?.({ ctx, model: { world: {}, cells: [cell] }, camera: { k: zoom, cx: 0, cy: 0 },
      toScreenX: (x) => x * zoom, toScreenY: (y) => y * zoom,
      colourOf: () => '#9d9fd3', theme: { font: 'monospace', text: '#eee' } }); } };
  try {
    dispose = installChapterDestination(map, { revealContent: true, dwellMs: 10, getRevealZoom: () => 15,
      loadChapter: () => { requests++; return new Promise((done) => { resolve = done; }); } });
    assert.equal(map.root.children.length, 0);
    await wait(20); assert.equal(requests, 0);
    zoom = 15; map.render();
    const root = map.root.children[0], body = root.children[1], skeleton = root.children[2].children[0];
    assert.equal(root.style.display, 'block', 'skeleton appears at the chosen threshold before dwell');
    assert.equal(skeleton.attributes['aria-hidden'], 'true');
    assert.ok(skeleton.children.length > 0);
    assert.equal(body.style.display, 'none');
    await wait(20); assert.equal(requests, 1);
    resolve({ verses: ['First verse text.', 'Second verse text.'] }); await wait();
    assert.equal(body.style.display, 'block', 'text replaces the skeleton when ready at 15×');
    assert.equal(skeleton.style.display, 'none');
    assert.equal(root.attributes['aria-busy'], 'false');
    assert.ok(parseFloat(root.style.fontSize) < 15);
    zoom = 40; map.render();
    assert.equal(root.style.fontSize, '14px'); assert.equal(requests, 1);
    assert.equal(map.root.children[0], root, 'zoom retains the same chapter view and data');
  } finally { dispose?.(); globalThis.document = originalDocument; }
});
