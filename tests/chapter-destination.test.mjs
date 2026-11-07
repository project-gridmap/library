import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Gridmap } from '../src/gridmap.js';
import { activeBook, activeChapter, chapterTextLayout, chapterTextPages, continuationText } from '../demo/chapter-destination.js';
const viewport = { w: 390, h: 700 };
const first = { id: 'RUT/2', x: 0, y: 0, width: 390, height: 400 };
const second = { id: 'RUT/3', x: 390, y: 0, width: 390, height: 400 };
const identity = (cell) => cell;

test('readability admits useful text space and retains it through modest reductions', () => {
  const entry = { x: 0, y: 0, width: 300, height: 300 };
  assert.ok(chapterTextLayout(entry, viewport));
  assert.equal(chapterTextLayout({ ...entry, width: 200 }, viewport), null);
  const smaller = { ...entry, width: 270, height: 260 };
  assert.equal(chapterTextLayout(smaller, viewport), null);
  assert.ok(chapterTextLayout(smaller, viewport, { retained: true }));
  assert.equal(chapterTextLayout({ ...smaller, width: 220 }, viewport, { retained: true }), null);
  const clipped = chapterTextLayout({ ...entry, x: -200 }, viewport);
  assert.equal(clipped, null, 'readability is based on the visible interior, not the offscreen cell size');
});

test('active chapter follows visible prominence and resists small changes in ranking', () => {
  const screen = { w: 900, h: 500 };
  const candidates = [
    { cell: { id: 'a' }, layout: { visibleArea: 170000, centerX: 230, centerY: 250 } },
    { cell: { id: 'b' }, layout: { visibleArea: 180000, centerX: 670, centerY: 250 } },
  ];
  assert.equal(activeChapter(candidates, screen), 'b');
  assert.equal(activeChapter(candidates, screen, 'a'), 'a');
  candidates[1].layout.visibleArea = 260000;
  assert.equal(activeChapter(candidates, screen, 'a'), 'b');
  assert.equal(activeChapter([], screen, 'a'), null);
});

test('prime book combines visible chapters and resists near-ties at book boundaries', () => {
  const screen = { w: 900, h: 500 };
  const candidates = [
    { cell: { itemId: 'RUT' }, layout: { visibleArea: 80000, centerX: 100, centerY: 250 } },
    { cell: { itemId: 'RUT' }, layout: { visibleArea: 80000, centerX: 400, centerY: 250 } },
    { cell: { itemId: 'EZR' }, layout: { visibleArea: 140000, centerX: 650, centerY: 250 } },
  ];
  assert.equal(activeBook(candidates, screen), 'RUT');
  assert.equal(activeBook(candidates, screen, 'EZR'), 'EZR');
  candidates[2].layout.visibleArea = 280000;
  assert.equal(activeBook(candidates, screen, 'RUT'), 'EZR');
  assert.equal(activeBook([], screen, 'RUT'), null);
  assert.equal(activeBook([
    { cell: { itemId: 'RUT' }, layout: { visibleArea: 60000, centerX: 450, centerY: 250 } },
    { cell: { itemId: 'EZR' }, layout: { visibleArea: 180000, centerX: 730, centerY: 250 } },
  ], screen), 'RUT', 'a narrow centred book wins over a much wider peripheral neighbour');
});

test('full chapter pages retain all 23 verses in order without losing or duplicating words', () => {
  const { verses } = JSON.parse(readFileSync(new URL('../demo/ruth-2.json', import.meta.url)));
  const pages = chapterTextPages(verses, 300, 8, (text) => text.length * 8);
  assert.ok(pages.length > 1);
  assert.ok(pages.every((page) => page.lines.length <= 8));
  const tokens = pages.flatMap((page) => page.lines.flatMap((line) => line.tokens));
  assert.equal(tokens.map((token) => token.text).join(' '), verses.join(' '));
  assert.deepEqual(tokens.filter((token) => token.verseStart).map((token) => token.verse), Array.from({ length: 23 }, (_, i) => i + 1));
  pages.slice(1).forEach((page, index) => assert.equal(page.start, pages[index].end));
  const reflowed = chapterTextPages(verses, 420, 12, (text) => text.length * 8);
  const anchor = pages[2].start;
  assert.equal(reflowed.filter((page) => anchor >= page.start && anchor < page.end).length, 1);
});

test('continuation replaces terminal punctuation, including before closing quotes', () => {
  assert.equal(continuationText('Boaz.'), 'Boaz…');
  assert.equal(continuationText('favor!”'), 'favor…”');
  assert.equal(continuationText('favor,'), 'favor…');
  assert.equal(continuationText('favor'), 'favor…');
  assert.equal(continuationText('favor…'), 'favor…');
});

test('chapter text and navigation fit the visible cell', () => {
  const box = { x: -100, y: 100, width: 590, height: 400 };
  const layout = chapterTextLayout(box, viewport);
  assert.ok(layout.left >= 16 && layout.top >= box.y + 16);
  assert.ok(layout.left + layout.width <= viewport.w - 16);
  assert.ok(layout.rows * 24 + 88 <= layout.height);
  assert.equal(chapterTextLayout({ ...box, width: 100 }, viewport), null);
});

test('text-enabled zoom range lets a wide phone chapter reach readability without changing default limits', () => {
  const screen = { w: 382, h: 686 };
  const map = Object.assign(Object.create(Gridmap.prototype), { options: {}, model: { world: {}, cellSide: 1.5 },
    viewport: () => screen, frame: () => ({ k: 1 }) });
  const normal = map.clampK(10000);
  assert.equal(normal, screen.w * 0.9 / 1.5);
  const layoutAt = (k) => chapterTextLayout({ x: screen.w / 2 - 1.8 * k / 2,
    y: screen.h / 2 - k / 2, width: 1.8 * k, height: k }, screen);
  assert.equal(layoutAt(normal), null);
  map.options.maxCellViewportRatio = 1.8;
  assert.ok(layoutAt(map.clampK(10000)));
  map.options.maxCellViewportRatio = -1;
  assert.equal(map.clampK(10000), normal);
});
