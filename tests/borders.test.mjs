import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { mergeSegments, ownedBorderSegments, rectangleSegments } from '../src/lines.js';
import { resolveSections } from '../src/model.js';

test('shared cell edges merge once, including unequal neighbouring rows', () => {
  const cells = [
    { x: 0, y: 0, width: 10, height: 10 },
    { x: 10, y: 0, width: 10, height: 10 },
    { x: 0, y: 10, width: 20, height: 10 },
  ];
  const lines = mergeSegments(cells.flatMap(rectangleSegments));
  assert.deepEqual(lines.filter((s) => s.y1 === 10 && s.y2 === 10), [
    { x1: 0, y1: 10, x2: 20, y2: 10 },
  ]);
  assert.equal(lines.length, 6);
  assert.deepEqual(mergeSegments(lines), lines);
});

test('border ownership follows input order at shared edges and T-junctions', () => {
  // The earliest book is deliberately below and right of its neighbours.
  const items = [
    { index: 0, x: 10, y: 10, width: 10, height: 10, groupIndex: 0, layerIndex: 0 },
    { index: 1, x: 0, y: 0, width: 20, height: 10, groupIndex: 1, layerIndex: 0 },
    { index: 2, x: 0, y: 10, width: 10, height: 10, groupIndex: 1, layerIndex: 0 },
  ];
  const layers = [{ x: 0, y: 0, width: 20, height: 20 }];
  const borders = ownedBorderSegments(items, layers);
  const segments = Object.values(borders).flat();
  const edge = (x1, y1, x2, y2) => segments.find((s) => s.x1 === x1 && s.y1 === y1 && s.x2 === x2 && s.y2 === y2);
  assert.equal(edge(10, 10, 20, 10).owner.index, 0, 'earlier book owns horizontal boundary');
  assert.equal(edge(10, 10, 10, 20).owner.index, 0, 'earlier book owns vertical boundary');
  assert.equal(edge(0, 10, 10, 10).owner.index, 1, 'T-junction splits the edge');
  assert.ok(borders.item.includes(edge(0, 10, 10, 10)), 'same-division books retain item weight');
  assert.ok(borders.group.includes(edge(10, 10, 20, 10)), 'division boundary keeps stronger weight');
  assert.equal(edge(0, 20, 10, 20).owner.index, 2, 'perimeter follows the adjoining book');
  assert.equal(edge(10, 20, 20, 20).owner.index, 0);
  const length = (s) => Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1);
  assert.equal(borders.layer.reduce((sum, s) => sum + length(s), 0), 80);
  assert.equal(segments.reduce((sum, s) => sum + length(s), 0), 110, 'every edge drawn once');
  assert.deepEqual(ownedBorderSegments([...items].reverse(), layers), borders, 'paint order cannot change ownership');
});

test('overlay study chapter groups preserve every book and chapter coordinate in both layouts', () => {
  const html = readFileSync(new URL('../demo/overlay.html', import.meta.url), 'utf8');
  // Exercise the demo's pure model functions independently of the browser.
  const geometry = html.slice(html.indexOf('const booksOf'), html.indexOf('const camera ='));
  const context = vm.createContext({ resolveSections, console });
  vm.runInContext(`${geometry}\nglobalThis.demo = { buildModel, WORLDS };`, context);
  const raw = JSON.parse(readFileSync(new URL('../bible.json', import.meta.url)));
  const groups = JSON.parse(readFileSync(new URL('../groups.json', import.meta.url)));
  const bible = raw.testaments.map((t) => ({
    id: `${t.name[0]}T`, name: `${t.name} Testament`,
    divisions: t.divisions.map((d) => ({
      id: d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: d.name, books: d.books,
    })),
  }));
  const coordinates = (model) => JSON.stringify([model.books, model.chapters].map((items) =>
    items.map(({ x, y, width, height }) => ({ x, y, width, height }))));
  for (const world of Object.values(context.demo.WORLDS)) {
    const plain = context.demo.buildModel(bible, world);
    const grouped = context.demo.buildModel(bible, world, groups);
    assert.equal(coordinates(grouped), coordinates(plain));
    assert.equal(grouped.chapters.length, 1189);
    assert.ok(grouped.chapterGroups.length > 100);
    assert.ok(grouped.chapterGroups.some((g) => g.book.key === 'MAT'), 'Matthew alias loads');
    const genesis = grouped.chapterGroups.filter((g) => g.book.key === 'GEN');
    assert.equal(genesis.map((g) => `${g.start}-${g.end}`).join(','), '1-11,12-36,37-50');
    for (const group of grouped.chapterGroups) {
      assert.equal(group.chapters.length, group.end - group.start + 1);
      assert.ok(group.chapters.every((c) => c.bookIndex === group.book.index));
    }
  }
});
