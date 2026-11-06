// Snapshot of Bible Game's map configuration, reviewed 6 November 2026.
// Sources in ~/Projects/bible-game/webapp:
//   src/app/play/[game]/map/gridmap.tsx
//   src/core/style/{ui-theme,play-theme,regions}.ts
// Keep application-specific settings here, outside the neutral library.
export const BIBLE_GAME_THEME = {
  background: 'transparent',
  text: '#f2f3f4',
  mutedText: '#93979e',
  faintText: '#93979e',
  cellLine: 'rgba(180, 195, 255, 0.06)',
  itemLine: 'rgba(180, 195, 255, 0.30)',
  groupLine: 'rgba(180, 195, 255, 0.16)',
  layerLine: 'rgba(180, 195, 255, 0.30)',
  sectionLine: 'rgba(180, 195, 255, 0.14)',
  sectionText: '#6e7280',
  selectedMark: '#05060a',
  font: '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};

const lightByMapTone = {
  '#6ab1c2': '#43cae7',
  '#9d9fd3': '#abaeff',
  '#c2877e': '#ed8c7f',
  '#7db392': '#70ce98',
  '#b6a36d': '#d4b455',
};

export function bibleGameOptions(colours, { mobile = false, narrativeHidden = false } = {}) {
  return {
    colours,
    selectedColours: Object.fromEntries(Object.entries(colours)
      .map(([book, colour]) => [book, lightByMapTone[colour.toLowerCase()] ?? colour])),
    colourParts: {
      borders: { opacity: 1 },
      sections: { opacity: 0.22 },
      marks: { coloured: false, opacity: narrativeHidden ? 0.2 : 0.28 },
      labels: { opacity: 1 },
    },
    colourBy: 'item',
    itemLabels: 'full',
    markType: 'number',
    numberMinPx: mobile ? 10 : 8,
    disabledCells: [],
    disabledOpacity: 0.9,
    layout: 'fit',
    showSections: true,
    sectionLabelSize: 9.5,
    theme: { ...BIBLE_GAME_THEME },
    labels: { tooltip: () => '' },
  };
}
