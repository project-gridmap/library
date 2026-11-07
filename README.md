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

## Colour

`colours` maps ids (items by default; see `colourBy`) to colours. By default every part of an item takes its
colour: its dark background, border, section partitions, marks and label. On a dense map that much colour shimmers, so
`colourParts` sets which parts are coloured and how strongly; the rest use the theme's neutrals.

```js
createGridmap({
  // ...
  colours,
  colourParts: {
    backgrounds: { opacity: 0.08 },
    borders: { opacity: 1 },
    sections: { opacity: 0.22 },
    marks: { coloured: false, opacity: 0.28 },
    labels: { opacity: 1 },
  },
  // the selected cell in a brighter tier than the map's own colours
  selectedColours: brighterColours,
});
```

## Background

Items have a dark tint of their own colour at 8% strength. With sections enabled,
section surfaces repeat at 7%, 9% and 8%, distinguishing neighbours without
implying a ranking. These fills stay below borders, marks and selection and do
not change layout. Labels use matching surface colours; `theme.labelBackground`
can override them. Set `colourParts.backgrounds.opacity` to tune the tint, or
`colourParts.backgrounds.coloured: false` to return to the plain theme background.
Items without a supplied colour retain the theme background.

Set `theme.background` to `'transparent'` (or any fully transparent colour) to draw the map straight onto the
page behind it. Disabled cells and the focus veil then fade by erasing, and labels cut the lines behind them
instead of sitting on a box. Set `theme.labelBackground` to keep a box.

## Typeface

The default `theme.font` is IBM Plex Mono, falling back to the system monospace: the library doesn't load fonts,
so load IBM Plex Mono on the page (e.g. Google Fonts, weights 400 and 500). Book names use `theme.labelWeight` (default 500); group labels use
`theme.sectionLabelWeight` (default 400).

## Disabled Cells

Cells passed to `disabledCells` (or `setDisabledCells`) can't be selected. They
sink under the background, or fade away when it is transparent (`disabledOpacity`, 0.9 by default), as whole items
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
Labels stay within two-thirds of their section's width. Complete names or
explicit `shortLabel` values appear only when they fit; truncated name fragments
are hidden. Chapter ranges appear with more padding at closer zoom.
`sectionLabelSize` overrides their font size in px (default 10, or 11 in phone-sized containers); larger labels need
deeper padding on screen before they show, so raise `sectionPadding` with it.

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

## Border hierarchy and demo groups

Borders keep a fixed screen weight as the camera zooms: layers 1.75 px,
group boundaries 1.25 px at 80% opacity, items 1 px, dotted sections
0.75 px at 30% opacity, and faint cell lines 0.5 px. Shared cell and neutral
region edges are merged before drawing so neighbouring regions do not add
extra emphasis. Corners stay square. Item and section labels use measured
text widths and matching background padding to leave clean breaks in borders.
`colourParts.sections.opacity` overrides the section strength.

Structural borders inherit the colour of their owning item, including group
boundaries and layer perimeters. Shared stretches belong to the earlier item
in input order (the earlier book in biblical order in the demo). Edges split
at junctions, so each perimeter stretch follows its adjoining book, and each
shared edge is drawn once at the appropriate hierarchy weight. The chapter
grid uses the book colour at a faint 8% strength; chapter numbers stay neutral
under the Bible Game preset, with a faint division tint in dots. Uncoloured items fall back to the corresponding
theme line colour. `colourParts.borders.coloured: false` restores the neutral
structural and chapter lines.


The main demo (`index.html`) renders through the public `createGridmap` API.
`demo/bible-game-config.js` mirrors the Bible Game web app's map preset from
`~/Projects/bible-game/webapp/src/app/play/[game]/map/gridmap.tsx` and its style
modules (reviewed 6 November 2026). It uses the fitted layout, full book labels,
neutral chapter marks at 28%, brighter selection colours, chapter groups on,
9.5 px group labels, and the app's transparent map theme. The main demo now
uses the library's responsive group-label sizes for the typography refinement; the
app preset itself remains a faithful snapshot. `demo/appearance.js` applies the
foreground-tone calibration and quieter border strength on top of that preset. Mobile chapter numbers
appear at 10 px; desktop at 8 px. Library defaults, including the tinted surfaces,
apply where the app does not override them. The ground uses the app's colours,
held still and subdued for this demo. The preset is a local snapshot: update it when the
app's configuration changes; the demo has no runtime dependency on that checkout.

The existing `colours.json` matches the app's map palette, and `groups.json`
matches its named chapter ranges. The adapter maps testaments to layers,
divisions to groups, books to items, and chapters to cells, with chapter groups
as sections. Cell ids follow the app's `BOOK/chapter` convention. Hash links
such as `#GEN`, `#GEN.12` and `#the-law` remain available; select a chapter and
use the reference buttons to focus its division, book or chapter.

`sections.html` remains the section-layout test page. The earlier independent
renderer, its chapter-group overlays and optional game proof of concept are
preserved at `demo/overlay.html` as a visual study. That study retains its black
surround, fixed chapter positions and `CONFIG.surfaceOpacity` setting; the main
demo uses the library's padded section layout, matching the app.

## Progressive labels

Book labels separate the smaller, quieter canonical number from the name:
`1 GENESIS`, then `1 GEN`, then `1` as room decreases. Numerals that belong to
book names (such as `1 SAMUEL`) remain part of the name. Names retain uppercase
Plex Mono Medium with tighter tracking. Upgrading to a fuller name needs 6 px
of extra room; labels shorten as soon as they no longer fit. Their border
interruptions keep 6 px of corner clearance, 4 px of padding on each side of
the text, and a clear line tail before the next junction.

Groups use regular weight, tighter tracking and lower emphasis than books.
Book names are 11 px, group names 10 px, book-number prefixes 9 px and testament
labels 11.5 px. In containers up to 699 px wide these become 12, 11, 10 and
12 px respectively. All remain fixed screen sizes as the camera zooms. Group
labels use 82% opacity, with chapter ranges quieter beneath them. An explicit
`sectionLabelSize` continues to override the automatic group size.
Their labels show complete names or supplied editorial short names, with
chapter ranges reserved for closer inspection. A label waits when it would
collide with another label. These are screen-space refinements; book, group
and chapter geometry is unchanged.

## Chapter markers

Dot size retains its square-root mapping to cell value (verse count in the
Bible demo), including the existing minimum and zoom scaling. Resting dots
use 17/14 of the configured mark opacity, clamped to 1: the app's 28% becomes
34%, while its dimmed 20% becomes about 24%. `dotOpacity` overrides this without
changing chapter-number opacity. Otherwise neutral dots blend in 12% of their
item colour (`dotTint`, set to 0 for fully neutral dots). Explicitly coloured
marks keep their supplied colour. Chapter numbers retain their existing colour,
size, weight and reveal threshold.

Hover brightens the existing core and adds one 0.75 px outline with a 1.5 px
clear gap. The core never grows on hover. The outline is omitted when it would
crowd a cell border and disappears when numbers are shown. It has no glow or
animation. A touch press uses the same emphasis, clearing on release, cancel,
pan or pinch. Selection retains the filled chapter cell and its dark mark.

## Colour and atmosphere

Geographic colours remain the source for book interiors and marker tint.
`foregroundColours` optionally supplies separate tones for borders, labels and
section partitions, using the same keys as `colours`. Missing foreground tones
fall back to the geographic colour. This leaves neutral marks and
`selectedColours` independent. The demo lifts only coral's foreground tone from
`#c2877e` to `#c98d84` (approximately OKLCH lightness 0.68 to 0.70, preserving
hue and chroma), and draws resting structural borders at 92% strength.

Group surfaces use a narrower variation: 7%, 9%, 8% around the 8% book tint.
`sectionSurfaceVariation` controls the variation as a fraction of the base
(default `0.125`; `0` makes every group the base tone, `0.25` restores 6/10/8%).
The page's static atmospheric washes are weaker and less purple, retaining the
near-black base. Selected chapters keep their existing flat bright fill; a
subtle gradient was compared and omitted because it added little clarity.
Typography, ownership boundaries, chapter geometry and marker behaviour remain
unchanged by these colour refinements.

## Visual attention

Hover or a touch press creates one attention chain: chapter, internal group,
then containing book. The book label gets a small 6% light blend, and its
structural edges regain prominence (92% to 100% in the demo). Shared edges keep
their earlier-book colour ownership, including edges adjoining the inspected
book that another book owns. Weights and positions do not change.

The active chapter group raises its existing dotted lines from 22% to 30% and
its already-visible label from 82% to 95%. Its resting markers lift slightly
(34% to 38% for dots; 28% to 32% for numbers); the rest of the containing book
receives a smaller lift. This changes luminosity only: marker sizes, colour,
number typography and selection styling remain intact. Disabled chapters do
not receive the marker lift. The same group and book cues stay steady while
inspection moves between chapters in that group. Hover does not reveal extra
labels or change the camera.

Explicit book or division focus retains its local cues after hover ends;
chapter focus also retains the containing chapter group. The surrounding map
and its labels fade by only 16% (`focusOpacity`, 0–1), rather than 66%. This
focus treatment is applied once, without additional hover veils. Disabled-cell
fading remains separate. No animation or new glow is added. Focus changes clear
transient hover/press emphasis and preserve the selected chapter.

## Semantic zoom and inspection

The main demo enables `semanticZoom`. At overview depth, the renderer favours
book abbreviations and adds complete division names in free space along their
existing boundaries. Muted colour-filled tabs with dark lettering distinguish
division captions from numbered book labels. Each caption keeps a preferred anchor chosen in the neutral
overview, independent of hover or the current camera. Crowding or clipping hides
it rather than moving it to another edge; a different responsive map geometry
gets its own anchors. Closer exploration or
book attention restores full names where they fit; chapter groups and numbers
retain their existing space-based reveal rules. No region geometry changes.
The library option defaults to false so other applications can adopt the
experiment explicitly.

### Chapter text experiment

Enable `?chapterContent=1` and zoom naturally. Visible, enabled chapters in the
prime book can reveal their full text; other books keep their chapter markers.
The prime book follows combined visible chapter area and centrality, with a 25%
switching margin to prevent jitter at boundaries. Keyboard focus within a
chapter's controls retains its book while it remains eligible. Selection does
not choose the reading book. Each chapter has independent page controls and remembers
its reading position. Numeric subscripts identify verses; continuation ellipses
replace terminal punctuation on nonfinal pages. Selection stays independent,
and scrolling/pinching/panning remain normal map navigation.
Chapter text and skeletons retain the original book/group surface, replacing
the chapter mark without a new reading background. Text contrast stays constant
across selection and prime focus; the selected boundary remains visible.
Scripture uses IBM Plex Serif at regular weight; chapter references, subscript
verse numbers and controls retain the map's IBM Plex Mono. Pagination measures
the two fonts separately and reflows when web fonts load, retaining the reading anchor.

The top-right zoom tuner reports overview-relative zoom (`1×` = whole map).
“Text from” sets the reveal factor; “Use current zoom” captures it. The setting
is stored in the URL, e.g. `?chapterContent=1&textZoom=5`. Editing it applies a fresh
admission test. With a manual factor, the previous 25-character / six-line gate
no longer delays text until much later: compact type progressively grows from
7 px to the full 14 px reading size as the available cell space increases.
Tiny cells that cannot hold two lines retain their skeleton instead of clipped
text. Compact controls scale with the cell and grow to full touch targets;
Verse ranges (e.g. `1–2/23`) identify the visible verses out of the chapter total,
including a verse continued from the preceding page. A single verse reads `3/23`.
Ranges hide where they cannot fit alongside both carets. Full-size range labels
use 15 px type; drawn caret controls use a larger 32 px scale in a 64 px footer.

For a manual factor of `15`, chapter skeletons and fetching start at `15×`;
there is no earlier skeleton reveal. Text replaces the skeleton when data is
ready and a compact passage fits. Loading skeletons use up to six short rows of
division-tinted word-like strokes, suggesting text without implying verse structure,
with a gentle 1.8-second opacity pulse, without shimmer or glow. Reduced-motion
preferences keep them static. They reserve the text footprint with an accessible loading
status. Existing text survives modest zoom reductions. Requests are cancelled
when the chapter leaves the preparation region; cached chapters are reused.

`0` retains automatic disclosure based on available reading space: roughly 25
characters and six body lines to introduce text, with a smaller exit threshold.
In automatic mode skeletons/fetching begin at the preceding four-line stage.
In either mode, multiple chapters may appear together; visible area, centre
proximity and a 25% preference for the existing target determine gentle emphasis
and fetch priority, not whether neighbours get text or page controls.

The replaceable `loadChapter(cell, { signal })` uses the host's service or the
cached World English Bible [Bible API](https://bible-api.com/) source. Two requests
at most are in flight; the public demo spaces requests by 2.1 seconds and keeps
skeletons visible during rate-limit cooldowns. Timeout and Retry remain available. Disabled chapters and
content-hidden gameplay reveal/fetch nothing. The query flag is a demo switch,
not a production gameplay permission policy.

The text-enabled demo allows deeper manual zoom via `maxCellViewportRatio: 1.8`.
This generic library option limits nominal cell size relative to the viewport's
shorter side; its default remains `0.9` elsewhere. Camera framing is unchanged.

The existing reference area now exposes a navigable path from testament through
division, book, named chapter group and chapter. Its second line reveals book
and chapter counts, group ranges or a chapter's verse count from the existing
data. Desktop hover is a temporary preview; tap/click selection is persistent.
Keyboard focus on a reference previews its details without moving the camera;
activation focuses that region. Mobile paths scroll horizontally with 44 px
high targets. Selection is retained when inspecting another level.

The neutral library API adds `focusLayer(id)`, `focusSection(uidOrIndex)`,
`focusParent()` and `getFocus()`. Escape and background taps step to the immediate
parent: cell → named section → item → group → layer → map. Unnamed filler
sections are skipped. Wheel and pinch continue to move the camera independently.
Turning sections off falls back from section focus to its book, and responsive
rebuilds rebind focus and selection by identity.

Deep links include `#old`, `#the-law`, `#GEN`, `#GEN/group/12-36`, and `#GEN.12`.
Opening a chapter link selects it; subsequent back/forward navigation changes
focus while retaining the user's selection. The five division colours keep
their geographic meaning, and the map's type, boundaries and marker sizing are
unchanged.
