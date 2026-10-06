# Project Gridmap

Project Gridmap is a content-agnostic hierarchical grid map renderer. It knows
about layers, groups, items, and cells. It does not know what those things mean.

## Install

```bash
npm install @project-gridmap/library
```

## Usage

```js
import { createGridmap } from '@project-gridmap/core';

const map = createGridmap({
  container: document.getElementById('map'),
  data: {
    layers: [
      {
        id: 'course',
        label: 'Course',
        groups: [
          {
            id: 'module-a',
            label: 'Module A',
            items: [
              {
                id: 'lesson-1',
                label: 'Lesson 1',
                shortLabel: 'L1',
                cells: [
                  { id: 'lesson-1.1', label: '1', value: 12 },
                  { id: 'lesson-1.2', label: '2', value: 8 },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  colours: {
    'lesson-1': '#c6feff',
  },
  onSelectCell(cell) {
    console.log(cell.id);
  },
});
```

## Data Model

Gridmap uses a fixed neutral hierarchy:

```txt
layer > group > item > cell
```

The order of the input data is preserved. Cell `value` is optional and is used
for relative mark sizing when `relativeMarkSize` is enabled.

## API

```js
map.focusMap();
map.focusGroup('module-a');
map.focusItem('lesson-1');
map.focusCell('lesson-1.2');
map.selectCell('lesson-1.2');
map.setDisabledCells(['lesson-1.1']);
map.isCellDisabled('lesson-1.1'); // true
map.addLayer((helpers) => {});
map.setData(data);
map.setColours(colours);
map.destroy();
```

Custom layers let applications draw domain-specific overlays without adding
domain language to the library.

## Disabled Cells

Cells passed to `disabledCells` (or `setDisabledCells`) can't be selected. They
sink under the background (`disabledOpacity`, 0.9 by default), as whole items
where every cell is disabled, and the labels of fully disabled items and layers
fade with them. Hovering or tapping one shows `labels.disabled(cell)`, so the
application can say why, and emits `selectDisabledCell`; the selection is left
unchanged. `selectCell` itself is not blocked, so applications stay in control.

```js
const map = createGridmap({
  // ...
  disabledCells: ['lesson-1.1'],
  labels: {
    disabled: (cell) => `${cell.itemLabel} ${cell.label} is locked`,
  },
  onSelectDisabledCell(cell) {},
});
```

## Sections

An item can name runs of its cells with `sections` (1-based, inclusive). Set
`showSections: true` (or `setConfig({ showSections: true })`) to draw them as
dotted partitions in the item's colour (`theme.sectionLine` if it has none),
with small muted labels on their top borders, like the item label on the
item's, showing the cell range, e.g. "Genealogies (1-9)" (`theme.sectionText`
if no colour; override the text with `labels.section`).

Sections sit inside padding around the item (`sectionPadding`, a fraction of a
cell's side, 0.6 by default), which leaves room for the labels; a label shows
once the padding is deep enough on screen to hold it. Sections touch by
default; `sectionGap` (also a fraction of a cell's side) opens a gap between
them. Both come out of the cells inside the item, never the item itself, so the
rest of the map stays put. Off, the layout is unchanged.

An item with a single section is framed and labelled like any other, so its
name still shows. `sectionFrame: 'open'` trims the
frame to what the labels need: padding along the top only, a dotted top edge,
and the dividers, without the outline down the sides and along the bottom.
Labels are kept within two-thirds of their section's width, and cut short with an ellipsis beyond that.

Cells no section claims fall into unlabelled sections, and overlapping or
out-of-range ranges are dropped or clamped, so no cell is ever lost. Each cell
carries a `sectionIndex` into `model.sections`.

```js
const map = createGridmap({
  // ...
  showSections: true,
  data: {
    layers: [{ groups: [{ items: [{
      id: 'GEN',
      cellCount: 50,
      sections: [
        { label: 'Creation', start: 1, end: 11 },
        { label: 'Patriarchs', start: 12, end: 50 },
      ],
    }] }] }],
  },
});
```
