// Visual refinements over the faithful Bible Game configuration snapshot.
// Keep geographic colours, marker colours and selected colours independent.
export function refineMapAppearance(options) {
  return {
    ...options,
    foregroundColours: Object.fromEntries(Object.entries(options.colours)
      .map(([id, colour]) => [id, colour.toLowerCase() === '#c2877e' ? '#c98d84' : colour])),
    colourParts: {
      ...options.colourParts,
      borders: { ...options.colourParts.borders, opacity: 0.92 },
    },
    sectionLabelSize: undefined,
  };
}
