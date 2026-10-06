export type GridmapCellInput = {
  id?: string | number;
  label?: string;
  value?: number | null;
  meta?: Record<string, unknown>;
};

/** A named run of an item's cells, 1-based and inclusive. Shown when `showSections` is on. */
export type GridmapSectionInput = {
  label?: string;
  name?: string;
  shortLabel?: string;
  start: number;
  end: number;
};

export type GridmapItemInput = {
  id?: string;
  /** Optional named runs of cells. Gaps are filled with unlabelled sections; overlaps and out-of-range values are dropped or clamped. */
  sections?: GridmapSectionInput[];
  key?: string;
  label?: string;
  name?: string;
  shortLabel?: string;
  cells?: Array<GridmapCellInput | string | number>;
  cellCount?: number;
  cellsCount?: number;
  meta?: Record<string, unknown>;
};

export type GridmapGroupInput = {
  id?: string;
  label?: string;
  name?: string;
  items: GridmapItemInput[];
  meta?: Record<string, unknown>;
};

export type GridmapLayerInput = {
  id?: string;
  label?: string;
  name?: string;
  groups?: GridmapGroupInput[];
  items?: GridmapItemInput[];
  meta?: Record<string, unknown>;
};

export type GridmapData = {
  layers: GridmapLayerInput[];
  meta?: Record<string, unknown>;
};

export type GridmapRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type GridmapCell = GridmapRect & {
  index: number;
  id: string;
  label: string;
  value: number | null;
  meta: Record<string, unknown>;
  layerId: string;
  layerLabel: string;
  layerIndex: number;
  groupId: string;
  groupLabel: string;
  groupIndex: number;
  itemId: string;
  itemLabel: string;
  itemShortLabel: string;
  itemIndex: number;
  ordinal: number;
  /** Index into model.sections, or -1 when sections are off. */
  sectionIndex: number;
  centerX: number;
  centerY: number;
};

export type GridmapItem = GridmapRect & {
  index: number;
  id: string;
  label: string;
  shortLabel: string;
  meta: Record<string, unknown>;
  layerId: string;
  layerLabel: string;
  layerIndex: number;
  groupId: string;
  groupLabel: string;
  groupIndex: number;
  cellCount: number;
  cells: GridmapCell[];
  /** Empty unless sections are on and the item has some. */
  sections: GridmapSection[];
  /** Lines midway between neighbouring sections, for drawing partitions. */
  dividers: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  /** The padded rect the sections fill (null without sections). Section labels sit on its borders. */
  inner: GridmapRect | null;
  /** World-unit padding between the item's top border and `inner`. */
  sectionPadding: number;
  /** True when the frame is open: only the top (and the dividers) are drawn. */
  openFrame: boolean;
};

export type GridmapSection = GridmapRect & {
  index: number;
  uid: string;
  /** Empty for the unlabelled filler between named sections. */
  label: string;
  shortLabel: string | null;
  start: number;
  end: number;
  itemId: string;
  itemIndex: number;
  layerIndex: number;
  cellCount: number;
};

export type GridmapGroup = {
  index: number;
  uid: string;
  id: string;
  label: string;
  meta: Record<string, unknown>;
  layerId: string;
  layerLabel: string;
  layerIndex: number;
  items: GridmapItem[];
  bounds: GridmapRect;
  outline: Array<{ x1: number; y1: number; x2: number; y2: number; betweenGroups: boolean }>;
};

export type GridmapLayer = GridmapRect & {
  index: number;
  id: string;
  label: string;
  meta: Record<string, unknown>;
  groups: GridmapGroup[];
  items: GridmapItem[];
};

export type GridmapModel = {
  data: GridmapData;
  world: GridmapRect & { gutter?: number };
  layout?: string;
  /** Set on a model built for the 'fit' layout: its world's width / height. */
  fitRatio?: number;
  cellSide: number;
  layers: GridmapLayer[];
  groups: GridmapGroup[];
  items: GridmapItem[];
  sections: GridmapSection[];
  cells: GridmapCell[];
};

export type GridmapTheme = {
  background: string;
  text: string;
  mutedText: string;
  faintText: string;
  cellLine: string;
  itemLine: string;
  groupLine: string;
  layerLine: string;
  /** Partitions between an item's sections, for items with no colour. */
  sectionLine: string;
  /** Section labels, for items with no colour. */
  sectionText: string;
  /** The selected cell is filled in its colour; its mark (number or dot) takes this. Default black. */
  selectedMark: string;
  font: string;
  /** 0–1: neon bloom on coloured borders, labels, hover and selection, in whatever colours are supplied. 0 turns it off. Default 0. */
  glow: number;
};

export type GridmapLayerPainter = (args: {
  ctx: CanvasRenderingContext2D;
  model: GridmapModel;
  state: {
    hover: GridmapCell | null;
    selected: GridmapCell | null;
    focus: Record<string, unknown>;
  };
  camera: { cx: number; cy: number; k: number; free: boolean };
  rect: (rect: GridmapRect) => void;
  toScreenX: (x: number) => number;
  toScreenY: (y: number) => number;
  colourOf: (entity: GridmapCell | GridmapItem, fallback?: string) => string;
  theme: GridmapTheme;
}) => void;

export type GridmapOptions = {
  container: HTMLElement;
  data: GridmapData;
  worlds?: Record<string, GridmapRect & { gutter?: number }>;
  /**
   * 'auto' (default): the portrait or landscape world, by the container's orientation.
   * 'fit': a world shaped like the container, snapped to the nearest of `fitRatios`, so the map fills it.
   * Any other value: that world from `worlds`.
   */
  layout?: 'auto' | 'fit' | string;
  /** World shapes (width / height) the 'fit' layout may use. Defaults to DEFAULT_FIT_RATIOS. */
  fitRatios?: number[];
  colours?: Record<string, string>;
  colourBy?: 'item' | 'group' | 'layer' | 'cell';
  showMarks?: boolean;
  markType?: 'number' | 'dot';
  markOpacity?: number;
  relativeMarkSize?: boolean;
  markMaxSize?: number;
  numberMinPx?: number;
  itemLabels?: 'short' | 'full';
  history?: boolean;
  /** Show each item's `sections`: dotted partitions in the item's colour, with small labels on their borders. Default false. */
  showSections?: boolean;
  /** Gap between sections as a fraction of a cell's side. Default 0: sections touch. */
  sectionGap?: number;
  /** Padding inside an item, around its sections, as a fraction of a cell's side. It leaves room for section labels on the borders. Default 0.6. */
  sectionPadding?: number;
  /**
   * 'box' (default): a dotted frame around all of an item's sections, evenly padded.
   * 'open': padding only along the top, where the labels sit, and only the top edge and the dividers are drawn.
   */
  sectionFrame?: 'box' | 'open';
  /** Ids of cells that can't be selected: veiled almost to nothing; a tap shows `labels.disabled` instead of selecting. */
  disabledCells?: string[];
  /** 0–1: how much of a disabled cell the background hides. Default 0.9: barely visible. */
  disabledOpacity?: number;
  theme?: Partial<GridmapTheme>;
  labels?: {
    item?: (item: GridmapItem, map: Gridmap) => string;
    /** Text for a named section's label. Defaults to the name and its cell range, e.g. "Genealogies (1-9)". */
    section?: (section: GridmapSection, map: Gridmap) => string;
    tooltip?: (cell: GridmapCell, map: Gridmap) => string;
    /** The message for a disabled cell, shown on hover and when tapped (defaults to the tooltip). */
    disabled?: (cell: GridmapCell, map: Gridmap) => string;
  };
  onReady?: (map: Gridmap) => void;
  onHoverCell?: (cell: GridmapCell | null, map: Gridmap) => void;
  onSelectCell?: (cell: GridmapCell, map: Gridmap) => void;
  /** A disabled cell was tapped; the selection is unchanged. */
  onSelectDisabledCell?: (cell: GridmapCell, map: Gridmap) => void;
  onFocusChange?: (focus: Record<string, unknown>, map: Gridmap) => void;
  onDataChange?: (data: GridmapData, map: Gridmap) => void;
};

export const DEFAULT_WORLDS: Record<string, GridmapRect & { gutter: number }>;
export const DEFAULT_FIT_RATIOS: number[];
export const DEFAULT_SECTION_GAP: number;
export const DEFAULT_SECTION_PADDING: number;

/** The ratio nearest `aspect` (log scale), keeping `current` unless another is nearer by more than `slack`. */
export function pickFitRatio(aspect: number, ratios?: number[], current?: number | null, slack?: number): number;
/** A world of the given width / height ratio, for buildGridmapModel. */
export function fitWorld(ratio: number, gutter?: number): GridmapRect & { gutter: number };

/** An item's sections as a full ordered partition of its cells, or null if it has none. */
export function resolveSections(item: { cells: unknown[]; sections?: GridmapSectionInput[] }): Array<Required<Pick<GridmapSectionInput, 'start' | 'end'>> & { label: string; shortLabel: string | null }> | null;
export function normaliseGridmapData(data: GridmapData): GridmapData;
export function buildGridmapModel(
  data: GridmapData,
  world?: GridmapRect & { gutter?: number },
  options?: { sections?: boolean; sectionGap?: number; sectionPadding?: number; sectionFrame?: 'box' | 'open' },
): GridmapModel;
export function validateGridmapModel(model: GridmapModel): true;
export type GridmapCover = {
  rects: Array<GridmapItem | GridmapCell>;
  /** Indices of items whose every cell is covered. */
  items: Set<number>;
  /** Indices of layers whose every item is covered. */
  layers: Set<number>;
};

export function coverCells(model: GridmapModel, ids: Set<string>): GridmapCover;
export function cellAt(model: GridmapModel, x: number, y: number): GridmapCell | null;
export function itemsOf(layer: GridmapLayerInput): GridmapItemInput[];
export function createGridmap(options: GridmapOptions): Gridmap;

export class Gridmap {
  constructor(options: GridmapOptions);
  on(type: string, listener: (payload: unknown, map: Gridmap) => void): () => void;
  off(type: string, listener: (payload: unknown, map: Gridmap) => void): void;
  addLayer(layer: GridmapLayerPainter): () => void;
  setData(data: GridmapData): void;
  setColours(colours?: Record<string, string>): void;
  setConfig(config?: Partial<GridmapOptions>): void;
  getModel(): GridmapModel;
  getSelectedCell(): GridmapCell | null;
  setDisabledCells(ids?: Iterable<string>): void;
  isCellDisabled(idOrCell: string | GridmapCell): boolean;
  focusMap(): boolean;
  focusGroup(idOrGroup: string | GridmapGroup): boolean;
  focusItem(idOrItem: string | GridmapItem): boolean;
  focusCell(idOrCell: string | GridmapCell): boolean;
  selectCell(idOrCell: string | GridmapCell): boolean;
  destroy(): void;
}
