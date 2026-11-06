import assert from 'node:assert/strict';
import test from 'node:test';
import { fitLabel, fitSectionLabel } from '../src/labels.js';

test('book names stay stable around zoom thresholds without retaining an overflowing form', () => {
  const candidates = [
    { key: 'GENESIS', width: 100 }, { key: 'GEN', width: 60 }, { key: 'number', width: 8 },
  ];
  let previous;
  const forms = [60, 100, 97, 103, 106, 102, 99, 59, 7, 8, 14].map((width) => {
    const label = fitLabel(candidates, width, previous);
    previous = label?.key ?? null;
    if (label) assert.ok(label.width <= width);
    return previous;
  });
  assert.deepEqual(forms, ['GEN', 'GEN', 'GEN', 'GEN', 'GENESIS', 'GENESIS', 'GEN', 'number', null, null, 'number']);
});

test('group labels preserve complete names and reserve ranges for closer inspection', () => {
  const section = { label: 'Creation & Early History', shortLabel: 'Early History' };
  const measure = (text) => text.length;
  assert.equal(fitSectionLabel(section, 8, measure, '(1–11)', false), null);
  assert.deepEqual(fitSectionLabel(section, 14, measure, '(1–11)', true), { name: 'EARLY HISTORY', tail: '' });
  assert.deepEqual(fitSectionLabel(section, 50, measure, '(1–11)', false), { name: 'CREATION & EARLY HISTORY', tail: '' });
  assert.deepEqual(fitSectionLabel(section, 50, measure, '(1–11)', true), { name: 'CREATION & EARLY HISTORY', tail: ' (1–11)' });
});
