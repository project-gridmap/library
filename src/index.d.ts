export type GridmapCellInput = {
  id?: string | number;
  label?: string;
  value?: number | null;
  meta?: Record<string, unknown>;
};

export type GridmapItemInput = {
  id?: string;
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
  cellSide: number;
  layers: GridmapLayer[];
  groups: GridmapGroup[];
  items: GridmapItem[];
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
  font: string;
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
  layout?: 'auto' | string;
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
  theme?: Partial<GridmapTheme>;
  labels?: {
    item?: (item: GridmapItem, map: Gridmap) => string;
    tooltip?: (cell: GridmapCell, map: Gridmap) => string;
  };
  onReady?: (map: Gridmap) => void;
  onHoverCell?: (cell: GridmapCell | null, map: Gridmap) => void;
  onSelectCell?: (cell: GridmapCell, map: Gridmap) => void;
  onFocusChange?: (focus: Record<string, unknown>, map: Gridmap) => void;
  onDataChange?: (data: GridmapData, map: Gridmap) => void;
};

export const DEFAULT_WORLDS: Record<string, GridmapRect & { gutter: number }>;

export function normaliseGridmapData(data: GridmapData): GridmapData;
export function buildGridmapModel(data: GridmapData, world?: GridmapRect & { gutter?: number }): GridmapModel;
export function validateGridmapModel(model: GridmapModel): true;
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
  focusMap(): boolean;
  focusGroup(idOrGroup: string | GridmapGroup): boolean;
  focusItem(idOrItem: string | GridmapItem): boolean;
  focusCell(idOrCell: string | GridmapCell): boolean;
  selectCell(idOrCell: string | GridmapCell): boolean;
  destroy(): void;
}
