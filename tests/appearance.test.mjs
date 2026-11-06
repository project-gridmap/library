import assert from 'node:assert/strict';
import test from 'node:test';
import { Gridmap } from '../src/gridmap.js';
import { bibleGameOptions } from '../demo/bible-game-config.js';
import { refineMapAppearance } from '../demo/appearance.js';

test('foreground calibration leaves geographic colours, markers, selection and the app preset intact', () => {
  const preset = bibleGameOptions({ JOB: '#C2877E', GEN: '#6AB1C2' });
  const appearance = refineMapAppearance(preset);
  const map = Object.assign(Object.create(Gridmap.prototype), { options: appearance });
  const book = { id: 'JOB' };
  for (const part of ['borders', 'labels', 'sections']) {
    assert.equal(map.partColour(part, book, '#ffffff'), '#c98d84');
  }
  assert.equal(map.partColour('backgrounds', book, '#000000'), '#C2877E');
  assert.equal(map.partColour('marks', book, '#f2f3f4'), '#f2f3f4');
  assert.equal(map.colourOf(book), '#C2877E', 'dot tint still uses the geographic colour');
  assert.equal(map.selectedColourOf(book), preset.selectedColours.JOB);
  assert.equal(appearance.colourParts.marks, preset.colourParts.marks);
  assert.equal(appearance.colours, preset.colours);
  assert.equal(appearance.selectedColours, preset.selectedColours);
  assert.equal(appearance.theme, preset.theme);
  assert.equal(preset.colourParts.borders.opacity, 1, 'preset was not mutated');
  assert.equal(preset.foregroundColours, undefined);
  appearance.colourParts.labels = { coloured: false };
  assert.equal(map.partColour('labels', book, '#ffffff'), '#ffffff');
});
