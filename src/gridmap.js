'use strict';

import { mergeSegments, ownedBorderSegments, rectangleSegments } from './lines.js';
import { surfaceColour, sectionSurfaceOpacity } from './surfaces.js';
import { anchoredBoundaryLabelPosition, boundaryLabelAnchor, fitLabel, fitSectionLabel } from './labels.js';
import { markerAttention, resolveAttention, sectionBorderParts } from './attention.js';
import { parentFocus, rebindFocus, resolveFocus } from './navigation.js';

import {
  DEFAULT_FIT_RATIOS, DEFAULT_SECTION_GAP, DEFAULT_SECTION_PADDING, DEFAULT_WORLDS, buildGridmapModel, cellAt, coverCells, fitWorld, normaliseGridmapData, pickFitRatio,
} from './model.js';

const DEFAULT_THEME = {
  background: '#000000',
  text: '#f7f7fa',
  mutedText: '#a3a3ad',
  faintText: '#5c5c66',
  cellLine: '#1c1c22',
  itemLine: '#94949a',
  groupLine: '#94949a',
  layerLine: '#94949a',
  sectionLine: '#3a3a42',
  sectionText: '#6e6e78',
  // The selected cell is filled in its colour; its mark (number or dot) takes this.
  selectedMark: '#000000',
  // IBM Plex Mono when the page loads it (even widths keep labels and numbers aligned), else the system monospace
  font: '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  // Book names in Medium; internal groups in quieter Regular.
  labelWeight: 500,
  sectionLabelWeight: 400,
  // Behind labels; defaults to the background. On a transparent background, labels cut the lines behind them instead.
  labelBackground: null,
  // 0–1: neon bloom on coloured borders, labels, hover and selection, in
  // whatever colours are supplied. Off by default.
  glow: 0,
};

const DEFAULT_OPTIONS = {
  worlds: DEFAULT_WORLDS,
  // 'auto': the portrait or landscape world, by orientation. 'fit': a world
  // shaped like the container (snapped to one of fitRatios), so it fills it.
  layout: 'auto',
  fitRatios: DEFAULT_FIT_RATIOS,
  colours: {},
  foregroundColours: {},
  colourBy: 'item',
  showMarks: true,
  markType: 'number',
  markOpacity: 0.75,
  // Resting dots are slightly firmer than numbers; explicit values override it.
  dotOpacity: null,
  // Neutral dots carry a trace of their item's colour; numbers stay neutral.
  dotTint: 0.12,
  // Which parts take the item colours, and how strongly: { coloured, opacity } for backgrounds, borders, sections, marks and
  // labels. Uncoloured parts use the theme's neutral colours. A map is calmer with colour on borders and labels only.
  colourParts: {},
  // Colours for the selected cell, keyed like `colours` (e.g. a brighter tier than the map's own), else its colour.
  selectedColours: {},
  relativeMarkSize: true,
  markMaxSize: 0.4,
  numberMinPx: 8,
  maxCellViewportRatio: 0.9,
  itemLabels: 'short',
  semanticZoom: false,
  history: false,
  focusOpacity: 0.16,
  // Items' `sections`: dotted partitions in the item's colour, with small
  // labels on their borders. The gap between sections and the padding around
  // them (fractions of a cell's side) reshape the layout. Off by default.
  showSections: false,
  sectionSurfaceVariation: 0.125,
  sectionGap: DEFAULT_SECTION_GAP,
  sectionPadding: DEFAULT_SECTION_PADDING,
  sectionFrame: 'box',
  // Section labels' font size in px. Larger labels need deeper padding before
  // they show, and take more of their section's width.
  sectionLabelSize: null, // automatic: 10 px, or 11 px in phone-sized containers
  // Cells that can't be selected: veiled almost to nothing, and a tap on one
  // shows its labels.disabled message instead of selecting it.
  disabledCells: [],
  disabledOpacity: 0.9,
  theme: DEFAULT_THEME,
  labels: {},
};

function mergeOptions(options) {
  return {
    ...DEFAULT_OPTIONS,
    ...options,
    worlds: { ...DEFAULT_WORLDS, ...(options.worlds ?? {}) },
    theme: { ...DEFAULT_THEME, ...(options.theme ?? {}) },
    labels: { ...(options.labels ?? {}) },
  };
}

function createElement(tag, attrs = {}, parent) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else el.setAttribute(key, value);
  }
  if (parent) parent.appendChild(el);
  return el;
}

// Neon on a coloured label: two soft shadows in its own colour.
const labelGlow = (colour, glow) => (colour && glow > 0
  ? `0 0 ${6 * glow}px ${colour}, 0 0 ${14 * glow}px ${colour}`
  : 'none');

// Containers with a map mounted in them, so a host can find the map from its page (Gridmap.from).
const mounted = new WeakMap();

// Glides ease in and out; the zoom moves by its ratio, so it feels even at every scale.
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const cameraOf = (camera) => ({ cx: camera.cx, cy: camera.cy, k: camera.k });

const median = (values, fallback = 1) => {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  return sorted.length ? sorted[sorted.length >> 1] : fallback;
};

export class Gridmap {
  /**
   * The map mounted in this element, in one of its ancestors, or (failing those) in one of its descendants: how a host
   * reaches a map that a component it doesn't own has made.
   */
  static from(element) {
    for (let el = element; el; el = el.parentElement) {
      const map = mounted.get(el);
      if (map && !map.destroyed) return map;
    }
    const root = element?.querySelector?.('.gridmap-root');
    const map = root ? mounted.get(root.parentElement) : null;
    return map && !map.destroyed ? map : null;
  }

  constructor(options) {
    if (!options?.container) throw new TypeError('createGridmap requires a container element');
    if (!options?.data) throw new TypeError('createGridmap requires data');

    this.options = mergeOptions(options);
    this.data = normaliseGridmapData(options.data);
    this.container = options.container;
    this.models = {};
    this.model = null;
    this.camera = { cx: 0, cy: 0, k: 1, free: false };
    this.state = { hover: null, selected: null, focus: { level: 'map' } };
    this.layers = new Set();
    this.layersAbove = new Set();
    this.glide = null;
    this.listeners = new Map();
    this.frameRequested = false;
    this.destroyed = false;
    this.pointers = new Map();
    this.drag = null;
    this.gesture = null;
    this.pressedCell = null;
    this.resizeObserver = null;
    this.disabled = new Set((this.options.disabledCells ?? []).map(String));
    this.disabledCover = null;
    this.itemLabelForms = new WeakMap();
    this.divisionLabelAnchors = new WeakMap();
    this.tooltipTimer = null;

    this.mount();
    mounted.set(this.container, this);
    this.rebuildModels();
    this.useLayout(this.layoutName());
    this.bind();
    this.render();
    this.emit('ready', this);
  }

  mount() {
    const style = getComputedStyle(this.container);
    if (style.position === 'static') this.container.style.position = 'relative';
    this.container.style.overflow = 'hidden';
    this.container.style.background = this.options.theme.background;

    this.root = createElement('div', { class: 'gridmap-root' }, this.container);
    Object.assign(this.root.style, {
      position: 'absolute',
      inset: '0',
      overflow: 'hidden',
      touchAction: 'none',
      userSelect: 'none',
      fontFamily: this.options.theme.font,
      color: this.options.theme.text,
    });

    this.canvas = createElement('canvas', { class: 'gridmap-canvas' }, this.root);
    Object.assign(this.canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
    this.ctx = this.canvas.getContext('2d');

    this.overlay = createElement('div', { class: 'gridmap-overlay' }, this.root);
    Object.assign(this.overlay.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      fontFamily: this.options.theme.font,
      fontSize: '10px',
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
    });

    this.tooltip = createElement('div', { class: 'gridmap-tooltip' }, this.root);
    Object.assign(this.tooltip.style, {
      position: 'absolute',
      pointerEvents: 'none',
      opacity: '0',
      padding: '5px 8px',
      background: this.options.theme.background,
      borderLeft: `1px solid ${this.options.theme.itemLine}`,
      color: this.options.theme.mutedText,
      fontSize: '10px',
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
      lineHeight: '1.6',
      transition: 'opacity 120ms',
    });
  }

  bind() {
    this.bound = {
      resize: () => this.resize(),
      pointerdown: (event) => this.onPointerDown(event),
      pointermove: (event) => this.onPointerMove(event),
      pointerup: (event) => this.onPointerUp(event),
      pointercancel: (event) => this.onPointerCancel(event),
      pointerleave: (event) => this.onPointerLeave(event),
      wheel: (event) => this.onWheel(event),
      keydown: (event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault();
          this.focusParent();
        }
      },
    };

    this.root.addEventListener('pointerdown', this.bound.pointerdown);
    this.root.addEventListener('pointermove', this.bound.pointermove);
    this.root.addEventListener('pointerup', this.bound.pointerup);
    this.root.addEventListener('pointercancel', this.bound.pointercancel);
    this.root.addEventListener('pointerleave', this.bound.pointerleave);
    this.root.addEventListener('wheel', this.bound.wheel, { passive: false });
    window.addEventListener('keydown', this.bound.keydown);

    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(this.bound.resize);
      this.resizeObserver.observe(this.container);
    } else {
      window.addEventListener('resize', this.bound.resize);
    }
  }

  // Models are built on first use, one per layout: a world, or a fit ratio.
  rebuildModels() {
    this.models = {};
  }

  modelFor(name) {
    if (!this.models[name]) {
      const ratio = name.startsWith('fit:') ? Number(name.slice(4)) : null;
      const world = ratio ? fitWorld(ratio) : this.options.worlds[name];
      const fallback = Object.keys(this.options.worlds)[0];
      if (!world) return name === fallback ? null : this.modelFor(fallback);
      const model = buildGridmapModel(this.data, world, {
        sections: this.options.showSections,
        sectionGap: this.options.sectionGap,
        sectionPadding: this.options.sectionPadding,
        sectionFrame: this.options.sectionFrame,
      });
      model.layout = name;
      if (ratio) model.fitRatio = ratio;
      this.models[name] = model;
    }
    return this.models[name];
  }

  layoutName() {
    if (this.options.layout === 'fit') return `fit:${this.fitRatio()}`;
    if (this.options.layout !== 'auto') return this.options.layout;
    return this.container.clientHeight > this.container.clientWidth ? 'portrait' : 'landscape';
  }

  // The fit ratio for the room left inside the margins.
  fitRatio() {
    const { w, h } = this.viewport();
    const m = this.margins();
    const aspect = Math.max(1, w - m.left - m.right) / Math.max(1, h - m.top - m.bottom);
    return pickFitRatio(aspect, this.options.fitRatios, this.model?.fitRatio ?? null);
  }

  useLayout(name) {
    const old = this.model;
    this.model = this.modelFor(name);
    this.borderSegments = ownedBorderSegments(this.model.items, this.model.layers);
    let changedFocus = false;
    if (old && old !== this.model) {
      this.state.hover = null;
      const selectedId = this.state.selected?.id;
      this.state.selected = this.model.cells.find((cell) => cell.id === selectedId) ?? null;
      const previous = this.state.focus;
      this.state.focus = rebindFocus(this.model, previous);
      changedFocus = previous.level !== this.state.focus.level;
    }
    this.disabledCover = null;
    this.pressedCell = null;
    this.prepareMarks();
    Object.assign(this.camera, this.cameraForFocus(), { free: false });
    this.resize();
    if (changedFocus) this.emit('focusChange', this.state.focus);
  }

  prepareMarks() {
    const values = this.model.cells.map((cell) => cell.value);
    this.medianValue = median(values);
    const sortedValues = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
    this.referenceValue = sortedValues[Math.floor(Math.max(0, sortedValues.length - 1) * 0.99)] ?? this.medianValue;
    const sizes = this.model.cells.map((cell) => this.numberWorldSize(cell)).sort((a, b) => a - b);
    this.medianNumberSize = sizes[sizes.length >> 1] || this.model.cellSide;
  }

  viewport() {
    return {
      w: Math.max(1, this.container.clientWidth),
      h: Math.max(1, this.container.clientHeight),
    };
  }

  // A resize that only changes the height a little, as a browser toolbar sliding in or out does (mobile browsers can
  // do this on every swipe), keeps the layout and the view: re-fitting would rearrange the map under the user's finger
  // and lose their place. A new width (a rotation, a resized window) or a big change in height re-fits as usual.
  isToolbarResize(w, h) {
    const last = this.lastViewport;
    return Boolean(last) && last.w === w && last.h > 1 && h !== last.h && Math.abs(h - last.h) <= last.h * 0.2;
  }

  resize() {
    if (this.destroyed || !this.model) return;
    const { w, h } = this.viewport();
    const toolbar = this.isToolbarResize(w, h);
    const nextLayout = this.layoutName();
    if (nextLayout !== this.model.layout && !toolbar) {
      this.lastViewport = null;
      this.useLayout(nextLayout);
      return;
    }

    // keep what's at the top of the map where it is, the edge a toolbar doesn't move
    if (toolbar && this.camera.free) this.camera.cy += (h - this.lastViewport.h) / (2 * this.camera.k);
    this.lastViewport = { w, h };

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const width = Math.round(w * dpr);
    const height = Math.round(h * dpr);
    // setting a canvas's size clears it, even to the same size, so only when it changes
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.dpr = dpr;
    const previous = cameraOf(this.camera);
    if (!this.camera.free) Object.assign(this.camera, this.cameraForFocus());
    this.render();
    this.emitCamera(previous, 'resize');
  }

  on(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
    return () => this.off(type, listener);
  }

  off(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type, payload) {
    this.listeners.get(type)?.forEach((listener) => listener(payload, this));
    const callback = this.options[`on${type[0].toUpperCase()}${type.slice(1)}`];
    if (typeof callback === 'function') callback(payload, this);
  }

  addLayer(layer, { above = false } = {}) {
    const layers = above ? this.layersAbove : this.layers;
    layers.add(layer);
    this.render();
    return () => {
      layers.delete(layer);
      this.render();
    };
  }

  setData(data) {
    this.data = normaliseGridmapData(data);
    this.rebuildModels();
    this.useLayout(this.layoutName());
    this.emit('dataChange', this.data);
  }

  setColours(colours = {}) {
    this.options.colours = colours;
    this.render();
  }

  setConfig(config = {}) {
    const before = this.options;
    this.options = mergeOptions({ ...this.options, ...config });
    if (config.disabledCells) this.setDisabledCells(config.disabledCells);
    // Sections change the geometry, so models built without them are stale.
    const sectionsChanged = Boolean(before.showSections) !== Boolean(this.options.showSections)
      || (this.options.showSections && (before.sectionGap !== this.options.sectionGap
        || before.sectionPadding !== this.options.sectionPadding
        || before.sectionFrame !== this.options.sectionFrame));
    if (sectionsChanged) this.rebuildModels();
    if (sectionsChanged || 'layout' in config || 'fitRatios' in config) {
      this.useLayout(this.layoutName());
      return;
    }
    this.prepareMarks();
    this.render();
  }

  setDisabledCells(ids = []) {
    this.disabled = new Set([...ids].map(String));
    this.options.disabledCells = [...this.disabled];
    this.disabledCover = null;
    this.render();
  }

  isCellDisabled(idOrCell) {
    const id = typeof idOrCell === 'string' ? idOrCell : idOrCell?.id;
    return id != null && this.disabled.has(id);
  }

  // Rebuilt lazily: the disabled set and the layout each invalidate it.
  getDisabledCover() {
    this.disabledCover ??= coverCells(this.model, this.disabled);
    return this.disabledCover;
  }

  getModel() {
    return this.model;
  }

  getSelectedCell() {
    return this.state.selected;
  }

  colourKey(entity) {
    return this.options.colourBy === 'group' ? entity.groupId
      : this.options.colourBy === 'layer' ? entity.layerId
      : this.options.colourBy === 'cell' ? entity.id
      : entity.itemId ?? entity.id;
  }

  colourOf(entity, fallback = this.options.theme.itemLine) {
    return this.options.colours?.[this.colourKey(entity)] ?? fallback;
  }

  part(name) {
    const part = this.options.colourParts?.[name] ?? {};
    return { coloured: part.coloured ?? true, opacity: part.opacity };
  }

  partColour(name, entity, neutral) {
    if (!this.part(name).coloured) return neutral;
    if (['borders', 'sections', 'labels'].includes(name)) {
      return this.options.foregroundColours?.[this.colourKey(entity)] ?? this.colourOf(entity, neutral);
    }
    return this.colourOf(entity, neutral);
  }

  selectedColourOf(entity) {
    return this.options.selectedColours?.[this.colourKey(entity)] ?? this.colourOf(entity, this.options.theme.text);
  }

  // A transparent background: the page shows through, so fading means erasing rather than painting the background on
  transparent() {
    const bg = String(this.options.theme.background ?? '').replace(/\s/g, '').toLowerCase();
    return bg === 'transparent' || /^rgba\(.*,0(\.0*)?\)$/.test(bg) || /^#[0-9a-f]{6}00$/.test(bg) || /^#[0-9a-f]{3}0$/.test(bg);
  }

  surfaceBackground(item, section = null) {
    const opacity = this.part('backgrounds').opacity ?? 0.08;
    const strength = section ? sectionSurfaceOpacity(item.sections.indexOf(section), opacity, this.options.sectionSurfaceVariation) : opacity;
    return surfaceColour(this.partColour('backgrounds', item, null), this.options.theme.background, strength);
  }

  labelBackground(item = null, section = null) {
    const theme = this.options.theme;
    if (theme.labelBackground != null) return theme.labelBackground;
    if (this.transparent()) return 'transparent';
    if (!item) return theme.background;
    const surface = this.surfaceBackground(item, section);
    const target = section ?? item;
    const region = this.focusRegion();
    const inside = region?.some((r) => target.x >= r.x && target.x < r.x + r.width
      && target.y >= r.y && target.y < r.y + r.height);
    return region && !inside ? surfaceColour(theme.background, surface, this.focusOpacity()) : surface;
  }

  attentionState() {
    return resolveAttention(this.model, this.state.focus, this.activeMarker());
  }

  focusOpacity() {
    return Math.min(1, Math.max(0, this.options.focusOpacity ?? 0.16));
  }

  labelContext(attention, item, section = null) {
    if (!attention.focused) return 1;
    if (!attention.focused.has(item.index)) return 1 - this.focusOpacity();
    if (section && attention.focusedSection != null && section.index !== attention.focusedSection) {
      return 1 - this.focusOpacity();
    }
    return 1;
  }

  glow() {
    return Math.min(1, Math.max(0, Number(this.options.theme.glow) || 0));
  }

  toScreenX(x) {
    const { w } = this.viewport();
    return (x - this.camera.cx) * this.camera.k + w / 2;
  }

  toScreenY(y) {
    const { h } = this.viewport();
    return (y - this.camera.cy) * this.camera.k + h / 2;
  }

  toWorldX(x) {
    const { w } = this.viewport();
    return (x - w / 2) / this.camera.k + this.camera.cx;
  }

  toWorldY(y) {
    const { h } = this.viewport();
    return (y - h / 2) / this.camera.k + this.camera.cy;
  }

  // Room kept around a framed region. Under 'fit' it's tight, bar a gutter
  // on the left for the rotated layer labels, so the map takes the rest.
  margins() {
    const { w, h } = this.viewport();
    const small = Math.min(w, h) < 700;
    if (this.options.layout === 'fit') {
      const margin = small ? 12 : 32;
      return { top: margin, right: margin, bottom: margin, left: margin + 24 };
    }
    const margin = small ? 24 : 56;
    return { top: margin, right: margin, bottom: margin, left: margin };
  }

  frame(rect, fill = 0.92) {
    const { w, h } = this.viewport();
    const m = this.margins();
    const availableW = Math.max(1, w - m.left - m.right);
    const availableH = Math.max(1, h - m.top - m.bottom);
    const k = Math.min(availableW / rect.width, availableH / rect.height, (w * fill) / rect.width, (h * fill) / rect.height);
    // centred in the room inside the margins, which is off-centre when they're uneven
    return {
      cx: rect.x + rect.width / 2 - (m.left - m.right) / 2 / k,
      cy: rect.y + rect.height / 2 - (m.top - m.bottom) / 2 / k,
      k,
    };
  }

  clampK(k) {
    const min = this.frame(this.model.world).k * 0.55;
    const ratio = Number(this.options.maxCellViewportRatio);
    const max = Math.min(this.viewport().w, this.viewport().h) * (ratio > 0 && Number.isFinite(ratio) ? ratio : 0.9) / this.model.cellSide;
    return Math.min(Math.max(k, min), max);
  }

  getCamera() {
    return cameraOf(this.camera);
  }

  /** Moves the camera as the host; it stops a glide. Reported as a 'cameraChange' from 'api'. */
  setCamera(cx, cy, k) {
    this.cancelGlide();
    this.placeCamera(cx, cy, k, 'api');
  }

  placeCamera(cx, cy, k, source) {
    const previous = cameraOf(this.camera);
    const world = this.model.world;
    this.camera.k = this.clampK(k);
    this.camera.cx = Math.min(Math.max(cx, world.x), world.x + world.width);
    this.camera.cy = Math.min(Math.max(cy, world.y), world.y + world.height);
    this.camera.free = true;
    // drags and pinches call this for every pointer event, often faster than the screen refreshes: draw once a frame
    this.requestRender();
    this.emitCamera(previous, source);
  }

  /** 'cameraChange' says where the camera went, from where, and why: 'user', 'focus', 'glide', 'resize' or 'api'. */
  emitCamera(previous, source) {
    const { cx, cy, k } = this.camera;
    if (cx === previous.cx && cy === previous.cy && k === previous.k) return;
    this.emit('cameraChange', { cx, cy, k, previous, source });
  }

  zoomAround(sx, sy, wx, wy, k, source = 'user') {
    k = this.clampK(k);
    this.placeCamera(wx - (sx - this.viewport().w / 2) / k, wy - (sy - this.viewport().h / 2) / k, k, source);
  }

  focusRegion() {
    const focus = this.state.focus;
    if (focus.level === 'cell') return [focus.cell];
    if (focus.level === 'section') return [focus.section];
    if (focus.level === 'layer') return [focus.layer];
    if (focus.level === 'item') return [focus.item];
    if (focus.level === 'group') return focus.group.items;
    return null;
  }

  cameraForFocus() {
    const focus = this.state.focus;
    if (focus.level === 'cell') return this.frame(focus.cell, 0.42);
    if (focus.level === 'section') return this.frame(focus.section, 0.8);
    if (focus.level === 'layer') return this.frame(focus.layer, 0.94);
    if (focus.level === 'item') return this.frame(focus.item, 0.72);
    if (focus.level === 'group') return this.frame(focus.group.bounds, 0.9);
    return this.frame(this.model.world, this.options.layout === 'fit' ? 1 : 0.92);
  }

  enterFocus(focus) {
    this.state.focus = focus;
    this.state.hover = null;
    this.pressedCell = null;
    this.showTooltip(null);
    this.root.style.cursor = '';
  }

  setFocus(level, value = null) {
    const focus = resolveFocus(this.model, level, value);
    if (!focus) return false;
    this.cancelGlide();
    this.enterFocus(focus);
    const previous = cameraOf(this.camera);
    Object.assign(this.camera, this.cameraForFocus(), { free: false });
    this.emit('focusChange', focus);
    this.render();
    this.emitCamera(previous, 'focus');
    return true;
  }

  /**
   * Focuses as setFocus does, but moves the camera there smoothly rather than jumping. The focus changes at once; the
   * camera eases from `from` (default: where it is) and settles where setFocus would leave it. A tap, drag, pinch or
   * scroll, another focus or setCamera stops it. Under reduced motion, or with no duration, it jumps.
   */
  glideTo(level, value = null, { duration = 1000, from = null } = {}) {
    const focus = resolveFocus(this.model, level, value);
    if (!focus) return false;
    this.cancelGlide();
    const start = from ? cameraOf(from) : cameraOf(this.camera);
    this.enterFocus(focus);
    const end = this.cameraForFocus();
    this.emit('focusChange', focus);
    const still = !(duration > 0) || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const place = (camera, free, source) => {
      const previous = cameraOf(this.camera);
      Object.assign(this.camera, camera, { free });
      this.render();
      this.emitCamera(previous, source);
    };
    if (still) {
      place(end, false, 'focus');
      return true;
    }
    const glide = { frame: 0, began: null };
    const step = (now) => {
      if (this.glide !== glide || this.destroyed) return;
      glide.began ??= now;
      const t = Math.min(1, (now - glide.began) / duration);
      if (t < 1) {
        const e = easeInOut(t);
        glide.frame = requestAnimationFrame(step);
        place({ cx: start.cx + (end.cx - start.cx) * e, cy: start.cy + (end.cy - start.cy) * e, k: start.k * (end.k / start.k) ** e }, true, 'glide');
      } else {
        this.glide = null;
        // where setFocus would leave it now, in case the map was resized on the way
        place(this.cameraForFocus(), false, 'glide');
      }
    };
    this.glide = glide;
    place(start, true, 'glide');
    glide.frame = requestAnimationFrame(step);
    return true;
  }

  /** Stops a glide where it is; true if one was moving. */
  cancelGlide() {
    if (!this.glide) return false;
    cancelAnimationFrame(this.glide.frame);
    this.glide = null;
    return true;
  }

  isGliding() {
    return this.glide !== null;
  }

  getFocus() { return this.state.focus; }
  focusMap() { return this.setFocus('map'); }
  focusLayer(idOrLayer) { return this.setFocus('layer', idOrLayer); }
  focusSection(idOrSection) { return this.setFocus('section', idOrSection); }
  focusParent() {
    const focus = parentFocus(this.model, this.state.focus);
    return this.setFocus(focus.level, focus[focus.level]);
  }
  focusGroup(idOrGroup) { return this.setFocus('group', idOrGroup); }
  focusItem(idOrItem) { return this.setFocus('item', idOrItem); }
  focusCell(idOrCell) { return this.setFocus('cell', idOrCell); }

  selectCell(idOrCell) {
    const cell = typeof idOrCell === 'string'
      ? this.model.cells.find((candidate) => candidate.id === idOrCell)
      : idOrCell;
    if (!cell) return false;
    this.state.selected = cell;
    this.emit('selectCell', cell);
    this.render();
    return true;
  }

  hitTest(sx, sy) {
    const cell = cellAt(this.model, this.toWorldX(sx), this.toWorldY(sy));
    const focus = this.state.focus;
    if (focus.level === 'cell') return cell === focus.cell ? cell : null;
    if (focus.level === 'section') return cell && cell.sectionIndex === focus.section.index ? cell : null;
    if (focus.level === 'layer') return cell && cell.layerIndex === focus.layer.index ? cell : null;
    if (focus.level === 'item') return cell && cell.itemIndex === focus.item.index ? cell : null;
    if (focus.level === 'group') return cell && cell.groupIndex === focus.group.index ? cell : null;
    return cell;
  }

  pointerPoint(event) {
    const rect = this.root.getBoundingClientRect();
    return {
      id: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  gesturePoints() {
    const points = [...this.pointers.values()];
    if (points.length < 2) return null;
    const [a, b] = points;
    const x = (a.x + b.x) / 2;
    const y = (a.y + b.y) / 2;
    const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    return { x, y, distance };
  }

  startDrag(point, moved = false) {
    this.drag = {
      id: point.id,
      startX: point.clientX,
      startY: point.clientY,
      cam: { ...this.camera },
      moved,
    };
    this.gesture = null;
  }

  startGesture() {
    this.clearPressedCell();
    this.clearHover();
    const points = this.gesturePoints();
    if (!points || points.distance <= 0) return;
    this.drag = null;
    this.gesture = {
      ...points,
      cam: { ...this.camera },
      worldX: this.toWorldX(points.x),
      worldY: this.toWorldY(points.y),
      moved: false,
    };
  }

  onPointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    this.cancelGlide();
    const point = this.pointerPoint(event);
    this.pointers.set(event.pointerId, point);
    clearTimeout(this.tooltipTimer);
    this.showTooltip(null);
    this.root.setPointerCapture?.(event.pointerId);

    if (this.pointers.size === 1) {
      this.startDrag(point);
      if (event.pointerType !== 'mouse') {
        const cell = this.hitTest(point.x, point.y);
        this.pressedCell = cell && !this.isCellDisabled(cell) ? cell : null;
        this.requestRender();
      }
      return;
    }

    if (this.pointers.size === 2) {
      this.startGesture();
    }
  }

  onPointerMove(event) {
    const point = this.pointerPoint(event);

    if (this.pointers.has(event.pointerId)) {
      this.pointers.set(event.pointerId, point);
    }

    if (this.gesture) {
      const points = this.gesturePoints();
      if (!points || points.distance <= 0) return;
      const distanceDelta = Math.abs(points.distance - this.gesture.distance);
      const moveDelta = Math.hypot(points.x - this.gesture.x, points.y - this.gesture.y);
      if (distanceDelta > 2 || moveDelta > 4) this.gesture.moved = true;
      if (this.gesture.moved) {
        const nextK = this.gesture.cam.k * (points.distance / this.gesture.distance);
        this.zoomAround(points.x, points.y, this.gesture.worldX, this.gesture.worldY, nextK);
      }
      return;
    }

    if (this.drag && this.pointers.has(event.pointerId)) {
      const dx = event.clientX - this.drag.startX;
      const dy = event.clientY - this.drag.startY;
      if (Math.hypot(dx, dy) > 4) this.drag.moved = true;
      if (this.drag.moved) {
        this.clearPressedCell();
        this.clearHover();
        const cam = this.drag.cam;
        this.placeCamera(cam.cx - dx / cam.k, cam.cy - dy / cam.k, cam.k, 'user');
      }
      return;
    }

    const hover = this.hitTest(point.x, point.y);
    if (hover !== this.state.hover) {
      this.state.hover = hover;
      this.root.style.cursor = hover && this.isCellDisabled(hover) ? 'not-allowed' : '';
      this.emit('hoverCell', hover);
      this.render();
    }
    this.showTooltip(hover, point.x, point.y);
  }

  onPointerUp(event) {
    this.clearPressedCell();
    const point = this.pointerPoint(event);
    const drag = this.drag;
    const wasTap = drag?.id === event.pointerId && !drag.moved && this.pointers.size === 1 && !this.gesture;
    this.pointers.delete(event.pointerId);
    this.root.releasePointerCapture?.(event.pointerId);

    if (this.pointers.size >= 2) {
      this.startGesture();
      return;
    }

    if (this.pointers.size === 1) {
      this.startDrag([...this.pointers.values()][0], true);
      return;
    }

    this.drag = null;
    this.gesture = null;

    if (wasTap) {
      const cell = this.hitTest(point.x, point.y);
      if (cell && this.isCellDisabled(cell)) this.refuseCell(cell, point, event.pointerType);
      else if (cell) this.selectCell(cell);
      else this.focusParent();
    }
  }

  // A tap on a disabled cell leaves the selection alone and says why. A mouse
  // already shows the message on hover; a finger covers the cell, so the
  // message flashes above it.
  refuseCell(cell, point, pointerType) {
    this.emit('selectDisabledCell', cell);
    if (pointerType === 'mouse') return;
    clearTimeout(this.tooltipTimer);
    this.showTooltip(cell, point.x, point.y, { aboveFinger: true });
    this.tooltipTimer = setTimeout(() => this.showTooltip(null), 2200);
  }

  onPointerCancel(event) {
    this.clearPressedCell();
    this.pointers.delete(event.pointerId);
    this.root.releasePointerCapture?.(event.pointerId);

    if (this.pointers.size >= 2) {
      this.startGesture();
      return;
    }

    if (this.pointers.size === 1) {
      this.startDrag([...this.pointers.values()][0], true);
      return;
    }

    this.drag = null;
    this.gesture = null;
  }

  clearPressedCell() {
    if (!this.pressedCell) return;
    this.pressedCell = null;
    this.requestRender();
  }

  clearHover() {
    if (!this.state.hover) return;
    this.state.hover = null;
    this.root.style.cursor = '';
    this.showTooltip(null);
    this.emit('hoverCell', null);
  }

  onPointerLeave() {
    if (this.pointers.size) return;
    this.clearHover();
    this.render();
  }

  onWheel(event) {
    event.preventDefault();
    this.cancelGlide();
    const rect = this.root.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const dy = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
    this.zoomAround(x, y, this.toWorldX(x), this.toWorldY(y), this.camera.k * Math.exp(-dy * 0.0015));
  }

  showTooltip(cell, x, y, { aboveFinger = false } = {}) {
    this.tooltip.style.opacity = cell ? '1' : '0';
    if (!cell) return;
    const format = this.options.labels.tooltip;
    const text = typeof format === 'function'
      ? format(cell, this)
      : `${cell.groupLabel} / ${cell.itemLabel} / ${cell.label}`;
    const disabled = this.isCellDisabled(cell);
    const explain = this.options.labels.disabled;
    this.tooltip.textContent = disabled && typeof explain === 'function' ? explain(cell, this) : text;
    this.tooltip.style.maxWidth = disabled ? '240px' : '';
    const width = this.tooltip.offsetWidth;
    const height = this.tooltip.offsetHeight;
    const { w, h } = this.viewport();
    let left, top;
    if (aboveFinger) {
      left = Math.min(x - width / 2, w - width - 8);
      top = y - 56 - height < 8 ? y + 48 : y - 56 - height;
    } else {
      left = x + 18 + width > w ? x - 18 - width : x + 18;
      top = y + 18 + height > h ? y - 18 - height : y + 18;
    }
    this.tooltip.style.transform = `translate(${Math.max(8, left)}px, ${Math.max(8, top)}px)`;
  }

  requestRender() {
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      this.render();
    });
  }

  render() {
    if (!this.model || this.destroyed) return;
    const { w, h } = this.viewport();
    const ctx = this.ctx;
    const theme = this.options.theme;
    const k = this.camera.k;
    const ox = w / 2 - this.camera.cx * k;
    const oy = h / 2 - this.camera.cy * k;
    const X = (x) => x * k + ox;
    const Y = (y) => y * k + oy;
    const rect = (r) => ctx.rect(X(r.x), Y(r.y), r.width * k, r.height * k);
    const strokeSegments = (segments) => {
      ctx.beginPath();
      for (const s of mergeSegments(segments)) {
        ctx.moveTo(X(s.x1), Y(s.y1));
        ctx.lineTo(X(s.x2), Y(s.y2));
      }
      ctx.stroke();
    };
    const onScreen = (r) => X(r.x) < w && X(r.x + r.width) > 0 && Y(r.y) < h && Y(r.y + r.height) > 0;

    ctx.setTransform(this.dpr || 1, 0, 0, this.dpr || 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = 1;
    ctx.setLineDash([]);

    const visibleItems = this.model.items.filter(onScreen);
    const attention = this.attentionState();

    // Stable item fields and repeating section tones sit below every mark,
    // border and interaction layer. Neither changes the model geometry.
    ctx.globalAlpha = 1;
    for (const item of visibleItems) {
      ctx.fillStyle = this.surfaceBackground(item);
      ctx.beginPath(); rect(item);
      if (this.options.showSections) item.sections.forEach(rect);
      ctx.fill('evenodd'); // Leave holes for section tones, including on transparent themes.
      if (this.options.showSections) for (const section of item.sections) {
        ctx.fillStyle = this.surfaceBackground(item, section);
        ctx.beginPath(); rect(section); ctx.fill();
      }
    }

    const hover = this.activeMarker();
    if (hover) {
      ctx.fillStyle = theme.text;
      ctx.globalAlpha = 0.07;
      ctx.beginPath();
      rect(hover);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    const lineAlpha = Math.min(1, Math.max(0, (this.model.cellSide * k - 6) / 6));
    if (lineAlpha > 0) {
      ctx.lineWidth = 0.5;
      for (const item of visibleItems) {
        const colour = this.part('borders').coloured ? this.colourOf(item, null) : null;
        ctx.globalAlpha = lineAlpha * (colour ? 0.08 * (this.part('borders').opacity ?? 1) : 1);
        ctx.strokeStyle = colour ?? theme.cellLine;
        strokeSegments(item.cells.filter(onScreen).flatMap(rectangleSegments));
      }
      ctx.lineWidth = 1;
      ctx.globalAlpha = 1;
    }

    // Section partitions: dotted, in the item's colour, fading in as cells grow big enough to read.
    const sectionAlpha = this.options.showSections
      ? Math.min(1, Math.max(0, (this.model.cellSide * k - 3) / 6))
      : 0;
    if (sectionAlpha > 0) {
      ctx.lineWidth = 0.75;
      ctx.setLineDash([1.5, 3]);
      for (const item of visibleItems) {
        if (!item.inner) continue;
        const section = attention.section?.itemIndex === item.index ? attention.section : null;
        const parts = sectionBorderParts(item, section);
        const opacity = this.part('sections').opacity ?? 0.3;
        ctx.strokeStyle = this.partColour('sections', item, theme.sectionLine);
        ctx.globalAlpha = sectionAlpha * opacity;
        strokeSegments(parts.resting);
        ctx.globalAlpha = sectionAlpha * Math.min(1, opacity * 15 / 11);
        strokeSegments(parts.active);
      }
      ctx.setLineDash([]);
    }

    // Structural borders inherit the earlier item's colour. A shared edge is
    // drawn once at its strongest structural weight, including T-junctions.
    const glow = this.glow();
    const batches = [];
    for (const [level, width, opacity, neutral] of [
      ['item', 1, 1, theme.itemLine],
      ['group', 1.25, 0.8, theme.groupLine],
      ['layer', 1.75, 1, theme.layerLine],
    ]) {
      const colours = new Map();
      for (const segment of this.borderSegments[level]) {
        const colour = this.partColour('borders', segment.owner, neutral);
        const emphasised = segment.itemIndices.some((index) => attention.items.has(index));
        const key = JSON.stringify([colour, emphasised]);
        if (!colours.has(key)) colours.set(key, { colour, segments: [], emphasised });
        colours.get(key).segments.push(segment);
      }
      for (const batch of colours.values()) batches.push({ ...batch, width, opacity });
    }
    if (glow > 0 && this.part('borders').coloured) for (const batch of batches) {
      ctx.strokeStyle = batch.colour;
      ctx.globalAlpha = 0.09 * glow;
      ctx.lineWidth = 6;
      strokeSegments(batch.segments);
      ctx.globalAlpha = 0.2 * glow;
      ctx.lineWidth = 2.5;
      strokeSegments(batch.segments);
    }
    for (const batch of batches) {
      ctx.strokeStyle = batch.colour;
      ctx.globalAlpha = batch.opacity * Math.min(1, (this.part('borders').opacity ?? 1) * (batch.emphasised ? 25 / 23 : 1));
      ctx.lineWidth = batch.width;
      strokeSegments(batch.segments);
    }
    ctx.globalAlpha = 1;

    const selected = this.state.selected;
    // The selected cell remains the light peak, with a precise flat fill.
    if (selected) {
      const colour = this.selectedColourOf(selected);
      ctx.strokeStyle = colour;
      ctx.fillStyle = colour;
      ctx.globalAlpha = 1;
      ctx.beginPath();
      rect(selected);
      ctx.fill();
      ctx.lineWidth = 1.25;
      ctx.shadowColor = colour;
      ctx.shadowBlur = 12 * glow;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    if (this.options.showMarks) this.renderMarks(ctx, X, Y, onScreen, attention);
    this.renderDisabled(ctx, rect, onScreen);

    const dot = this.dotSize();
    const helpers = {
      ctx,
      map: this,
      model: this.model,
      state: this.state,
      camera: this.camera,
      rect,
      toScreenX: X,
      toScreenY: Y,
      colourOf: (entity, fallback) => this.colourOf(entity, fallback),
      markRadius: (cell) => dot * this.markScale(cell) / 2,
      theme,
    };
    const paint = (layer) => { ctx.save(); layer(helpers); ctx.restore(); };
    this.layers.forEach(paint);

    this.renderVeil(ctx, rect);
    this.layersAbove.forEach(paint);
    this.renderLabels(X, Y, attention);
    if (this.labelBackground() === 'transparent') this.cutBehindLabels(ctx);
  }

  // On a transparent background a label box would show on the page, so each label cuts the lines behind it instead
  cutBehindLabels(ctx) {
    const labels = [...this.overlay.children].filter((el) => el.style.display !== 'none' && el.textContent);
    if (!labels.length) return;
    // measured on screen, so undo any scale an ancestor applies (a CSS transform) to get back to canvas pixels
    const origin = this.canvas.getBoundingClientRect();
    const sx = origin.width / (this.canvas.clientWidth || origin.width) || 1;
    const sy = origin.height / (this.canvas.clientHeight || origin.height) || 1;
    ctx.save();
    ctx.setTransform(this.dpr || 1, 0, 0, this.dpr || 1, 0, 0);
    for (const el of labels) {
      const r = el.getBoundingClientRect();
      ctx.clearRect((r.left - origin.left) / sx, (r.top - origin.top) / sy, r.width / sx, r.height / sy);
    }
    ctx.restore();
  }

  markScale(cell, floor = 0.4) {
    return this.options.relativeMarkSize && cell.value
      ? Math.max(floor, Math.sqrt(cell.value / this.medianValue))
      : 1;
  }

  numberWorldSize(cell) {
    const digits = String(cell.label).length;
    const share = this.options.relativeMarkSize && cell.value
      ? Math.min(1, Math.max(0.35, Math.sqrt(cell.value / this.referenceValue)))
      : 0.7;
    return Math.min(
      Math.min(cell.width, cell.height) * this.options.markMaxSize * share,
      cell.width * 0.7 / (digits * 0.6),
    );
  }

  // A dot's diameter at this zoom, before its cell's share (markScale)
  dotSize() {
    return Math.min(7, 3 * (this.camera.k / this.frame(this.model.world).k) ** 0.28);
  }

  useNumbers() {
    return this.options.markType === 'number' && this.medianNumberSize * this.camera.k >= this.options.numberMinPx;
  }

  renderMarks(ctx, X, Y, onScreen, attention = this.attentionState()) {
    const theme = this.options.theme;
    const useNumbers = this.useNumbers();
    const dot = this.dotSize();
    const damping = useNumbers
      ? Math.min(1, 24 / (this.medianNumberSize * this.camera.k))
      : 1;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const markOpacity = this.part('marks').opacity ?? this.options.markOpacity;
    const dotOpacity = Math.min(1, Math.max(0, this.options.dotOpacity ?? markOpacity * 17 / 14));
    const target = this.activeMarker() ?? attention.cell;
    const active = target && !this.isCellDisabled(target) ? target : null;
    for (const item of this.model.items) {
      const numberColour = this.partColour('marks', item, theme.text);
      const dotColour = this.part('marks').coloured ? numberColour
        : surfaceColour(this.colourOf(item, null), theme.text, this.options.dotTint);
      for (const cell of item.cells) {
        if (!onScreen(cell)) continue;
        const chosen = cell === this.state.selected;
        const strong = cell === active || chosen;
        const context = this.isCellDisabled(cell) ? 0 : markerAttention(cell, attention);
        const resting = useNumbers ? Math.min(1, markOpacity * (1 + context / 7))
          : Math.min(1, dotOpacity * (1 + context * 2 / 17));
        ctx.globalAlpha = chosen ? 1 : useNumbers ? (strong ? 1 : resting)
          : cell === active ? Math.min(1, Math.max(0.7, dotOpacity * 1.5)) : resting;
        // On its filled cell the selected mark is dark, so it reads against the colour.
        ctx.fillStyle = chosen ? theme.selectedMark : useNumbers ? numberColour : dotColour;
        // A selected dot grows, and becomes its number where the cell is big enough to read one.
        const room = Math.min(cell.width, cell.height) * this.camera.k;
        if (chosen && !useNumbers && room >= 14) {
          ctx.font = `500 ${Math.min(24, room * 0.55)}px ${theme.font}`;
          ctx.fillText(cell.label, X(cell.centerX), Y(cell.centerY));
        } else if (useNumbers) {
          const size = this.numberWorldSize(cell) * this.camera.k * damping;
          if (size < 2) continue;
          ctx.font = `${strong ? 500 : 400} ${Math.max(2, Math.min(24, size))}px ${theme.font}`;
          ctx.fillText(cell.label, X(cell.centerX), Y(cell.centerY));
        } else {
          const radius = dot * this.markScale(cell) / 2 + (chosen ? 1.2 : 0);
          ctx.beginPath();
          ctx.arc(X(cell.centerX), Y(cell.centerY), Math.max(chosen ? 2 : 0, radius), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    this.renderMarkEmphasis(ctx, X, Y, useNumbers, dot, active);
    ctx.globalAlpha = 1;
  }

  activeMarker() {
    if (this.gesture || this.drag?.moved) return null;
    const cell = this.pressedCell ?? this.state.hover;
    return cell && !this.isCellDisabled(cell) ? cell : null;
  }

  renderMarkEmphasis(ctx, X, Y, useNumbers, dot, hover = this.activeMarker()) {
    if (useNumbers || !hover || hover === this.state.selected) return;
    const radius = dot * this.markScale(hover) / 2;
    const width = 0.75;
    const ringRadius = radius + 1.5 + width / 2;
    // Omit the outline when crowded; never alter the data-sized core to fit it.
    if (ringRadius + width / 2 > Math.min(hover.width, hover.height) * this.camera.k / 2 - 1) return;
    ctx.save();
    ctx.strokeStyle = this.colourOf(hover, this.options.theme.text);
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = width;
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(X(hover.centerX), Y(hover.centerY), ringRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Disabled cells sink under the background, borders, marks and all, so
  // what's left in reach stands out. Whole items go as one rectangle.
  renderDisabled(ctx, rect, onScreen) {
    if (!this.disabled.size) return;
    const rects = this.getDisabledCover().rects.filter(onScreen);
    if (!rects.length) return;
    ctx.fillStyle = this.transparent() ? '#000' : this.options.theme.background;
    if (this.transparent()) ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = Math.min(1, Math.max(0, Number(this.options.disabledOpacity) || 0));
    ctx.beginPath();
    rects.forEach(rect);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  renderVeil(ctx, rect) {
    const region = this.focusRegion();
    if (!region) return;
    const { w, h } = this.viewport();
    ctx.fillStyle = this.transparent() ? '#000' : this.options.theme.background;
    if (this.transparent()) ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = this.focusOpacity();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    region.forEach(rect);
    ctx.fill('evenodd');
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  labelSizes() {
    const phone = this.viewport().w <= 699;
    return {
      item: phone ? 12 : 11,
      number: phone ? 10 : 9,
      layer: phone ? 12 : 11.5,
      section: Number(this.options.sectionLabelSize) > 0
        ? Number(this.options.sectionLabelSize) : phone ? 11 : 10,
    };
  }

  semanticOverview() {
    if (!this.options.semanticZoom) return false;
    if (['item', 'section', 'cell'].includes(this.state.focus.level)) return false;
    const pixels = this.medianNumberSize * this.camera.k;
    const threshold = this.options.numberMinPx;
    this.semanticDetail = this.semanticDetail ? pixels >= threshold - 0.75 : pixels >= threshold + 0.75;
    return !this.semanticDetail;
  }

  divisionAnchors(measure, sizes, lineHeight) {
    if (this.divisionLabelAnchors.has(this.model)) return this.divisionLabelAnchors.get(this.model);
    // Use the same neutral whole-map view even when the page opens directly
    // into a focused book. Hover and the current camera cannot choose anchors.
    const { w, h } = this.viewport();
    const camera = this.frame(this.model.world, this.options.layout === 'fit' ? 1 : 0.92);
    const X = (x) => (x - camera.cx) * camera.k + w / 2;
    const Y = (y) => (y - camera.cy) * camera.k + h / 2;
    const occupied = [];
    const verticals = Object.values(this.borderSegments).flat().filter((edge) => Math.abs(edge.x1 - edge.x2) < 1e-6);
    for (const item of this.model.items) {
      if (item.height * camera.k < sizes.item * 2.4) continue;
      const numberWidth = measure(String(item.index + 1), sizes.number, 0.03, 400);
      const custom = this.options.labels.item;
      const name = typeof custom === 'function' ? custom(item, this) : item.shortLabel;
      const candidates = name ? [{ width: numberWidth + 5 + measure(String(name).toUpperCase(), sizes.item, 0.09) }] : [];
      candidates.push({ width: numberWidth });
      const end = verticals.filter((edge) => edge.x1 > item.x + 6 / camera.k && edge.x1 < item.x + item.width
        && (Math.abs(edge.y1 - item.y) < 1e-6 || Math.abs(edge.y2 - item.y) < 1e-6))
        .reduce((right, edge) => Math.min(right, edge.x1), item.x + item.width);
      const chosen = candidates.find((candidate) => candidate.width + 24 <= (end - item.x) * camera.k);
      if (chosen) occupied.push({ x: X(item.x) + 6, y: Y(item.y) - lineHeight / 2, width: chosen.width + 8, height: lineHeight });
    }
    const anchors = new Map();
    for (const group of this.model.groups) {
      const width = measure(group.label.toUpperCase(), sizes.item, 0.12, 500) + 8;
      const edges = group.outline.map((edge) => ({ x1: X(edge.x1), y1: Y(edge.y1), x2: X(edge.x2), y2: Y(edge.y2) }));
      const anchor = boundaryLabelAnchor(edges, width, lineHeight, occupied, { w, h });
      if (!anchor) continue;
      anchors.set(group.index, {
        x: (anchor.x - w / 2) / camera.k + camera.cx,
        y: (anchor.y - h / 2) / camera.k + camera.cy,
        left: (anchor.left - w / 2) / camera.k + camera.cx,
        right: (anchor.right - w / 2) / camera.k + camera.cx,
      });
      const box = anchoredBoundaryLabelPosition(anchor, width, lineHeight, occupied, { w, h });
      if (box) occupied.push(box);
    }
    this.divisionLabelAnchors.set(this.model, anchors);
    return anchors;
  }

  renderLabels(X, Y, attention = this.attentionState()) {
    const overview = this.semanticOverview();
    const sizes = this.labelSizes();
    const lineHeight = Math.ceil(sizes.item * 1.35);
    const labelItem = this.options.labels.item;
    const measure = (text, size, spacing, weight = this.options.theme.labelWeight ?? 500) => {
      this.ctx.font = `${weight} ${size}px ${this.options.theme.font}`;
      return this.ctx.measureText(text).width + Math.max(0, text.length - 1) * size * spacing;
    };
    const selected = this.state.selected;
    const cover = this.disabled.size ? this.getDisabledCover() : null;
    const faded = 1 - Math.min(1, Math.max(0, Number(this.options.disabledOpacity) || 0));
    this.overlay.replaceChildren();
    const occupied = [];
    const verticals = Object.values(this.borderSegments).flat().filter((edge) => Math.abs(edge.x1 - edge.x2) < 1e-6);

    for (const layer of this.model.layers) {
      const h = layer.height * this.camera.k;
      const text = layer.label.toUpperCase();
      if (h < measure(text, sizes.layer, 0.32, 400) + 12) continue;
      const el = createElement('div', { text }, this.overlay);
      Object.assign(el.style, {
        position: 'absolute',
        left: `${X(layer.x) - 22}px`,
        top: `${Y(layer.y + layer.height / 2)}px`,
        transform: 'translate(-50%, -50%) rotate(-90deg)',
        transformOrigin: 'center',
        color: selected?.layerIndex === layer.index ? this.options.theme.layerLine : this.options.theme.mutedText,
        fontSize: `${sizes.layer}px`,
        letterSpacing: '0.32em',
        whiteSpace: 'nowrap',
        opacity: cover?.layers.has(layer.index) ? String(faded)
          : attention.focused && !layer.items.some((item) => attention.focused.has(item.index))
            ? String(1 - this.focusOpacity()) : '',
      });
    }

    for (const item of this.model.items) {
      const w = item.width * this.camera.k;
      const h = item.height * this.camera.k;
      if (h < sizes.item * 2.4) continue;
      const number = String(item.index + 1);
      const numberWidth = measure(number, sizes.number, 0.03, 400);
      const names = (typeof labelItem === 'function'
        ? [labelItem(item, this)]
        : this.options.itemLabels === 'short' || (overview && !attention.items.has(item.index))
          ? [item.shortLabel] : [item.label, item.shortLabel])
        .filter(Boolean).map((name) => String(name).toUpperCase());
      const candidates = [...new Set(names)].map((name) => ({
        key: name, name, width: numberWidth + 5 + measure(name, sizes.item, 0.09),
      }));
      candidates.push({ key: 'number', name: '', width: numberWidth });
      // Keep the mask clear of the next junction along this top border.
      const nextJunction = verticals.filter((edge) => edge.x1 > item.x + 6 / this.camera.k
        && edge.x1 < item.x + item.width
        && (Math.abs(edge.y1 - item.y) < 1e-6 || Math.abs(edge.y2 - item.y) < 1e-6))
        .reduce((right, edge) => Math.min(right, edge.x1), item.x + item.width);
      const available = Math.min(w, (nextJunction - item.x) * this.camera.k) - 24;
      const chosen = fitLabel(candidates, available, this.itemLabelForms.get(item));
      this.itemLabelForms.set(item, chosen?.key ?? null);
      if (!chosen) continue;

      const el = createElement('div', {}, this.overlay);
      const prefix = createElement('span', { text: number }, el);
      Object.assign(prefix.style, {
        fontSize: `${sizes.number}px`, fontWeight: '400', opacity: '0.65',
        letterSpacing: '0.03em', fontVariantNumeric: 'tabular-nums',
      });
      if (chosen.name) {
        const name = createElement('span', { text: chosen.name }, el);
        name.style.marginLeft = '5px';
      }
      occupied.push({ x: X(item.x) + 6, y: Y(item.y) - lineHeight / 2, width: chosen.width + 8, height: lineHeight });
      Object.assign(el.style, {
        position: 'absolute',
        left: `${X(item.x) + 6}px`,
        top: `${Y(item.y) - lineHeight / 2}px`,
        display: 'inline-flex',
        alignItems: 'center',
        height: `${lineHeight}px`,
        maxWidth: `${Math.max(0, available + 8)}px`,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'clip',
        color: attention.items.has(item.index)
          ? surfaceColour(this.options.theme.text, this.partColour('labels', item, this.options.theme.mutedText), 0.06)
          : this.partColour('labels', item, this.options.theme.mutedText),
        fontWeight: String(this.options.theme.labelWeight ?? 500),
        textShadow: labelGlow(this.colourOf(item, null), this.glow()),
        background: this.labelBackground(item),
        padding: '0 4px',
        fontSize: `${sizes.item}px`,
        letterSpacing: '0.09em',
        lineHeight: `${lineHeight}px`,
        opacity: cover?.items.has(item.index) ? String(faded)
          : String((selected?.itemIndex === item.index || attention.items.has(item.index) ? 1
            : this.part('labels').opacity ?? 0.88) * this.labelContext(attention, item)),
      });
    }

    if (this.options.semanticZoom) {
      const anchors = this.divisionAnchors(measure, sizes, lineHeight);
      for (const group of this.model.groups) {
        if (!overview && !group.items.some((item) => attention.items.has(item.index))) continue;
        const text = group.label.toUpperCase();
        const width = measure(text, sizes.item, 0.12, 500) + 8;
        const anchor = anchors.get(group.index);
        if (!anchor) continue;
        const projected = { x: X(anchor.x), y: Y(anchor.y), left: X(anchor.left), right: X(anchor.right) };
        const box = anchoredBoundaryLabelPosition(projected, width, lineHeight, occupied, this.viewport());
        if (!box) continue;
        const el = createElement('div', { text }, this.overlay);
        Object.assign(el.style, {
          position: 'absolute', left: `${box.x}px`, top: `${box.y}px`,
          padding: '0 4px', fontSize: `${sizes.item}px`, lineHeight: `${lineHeight}px`,
          fontWeight: '500', letterSpacing: '0.12em', whiteSpace: 'nowrap',
          color: this.options.theme.selectedMark,
          background: surfaceColour(this.partColour('labels', group.items[0], this.options.theme.mutedText), this.options.theme.selectedMark, 0.82),
          borderRadius: '1px',
          opacity: String(0.9 * this.labelContext(attention, group.items[0])),
        });
        occupied.push(box);
      }
    }
    if (this.options.showSections) this.renderSectionLabels(X, Y, cover, faded, occupied, attention);
  }

  // Small labels on each named section's top border, like the item label on
  // the item's: in the item's colour, muted. They sit in the item's padding,
  // so they show only once the padding is deep enough to hold one clear of
  // the item label, and where the text fits.
  renderSectionLabels(X, Y, cover, faded, occupied = [], attention = this.attentionState()) {
    const k = this.camera.k;
    const labelSection = this.options.labels.section;
    const size = this.labelSizes().section;
    const weight = this.options.theme.sectionLabelWeight ?? 400;
    this.ctx.font = `${weight} ${size}px ${this.options.theme.font}`;
    const measure = (text) => this.ctx.measureText(text.toUpperCase()).width + Math.max(0, text.length - 1) * size * 0.06;
    for (const section of this.model.sections) {
      if (!section.label) continue;
      const item = this.model.items[section.itemIndex];
      if (item.sectionPadding * k < size * 1.2 + 2) continue;
      const w = section.width * k;
      // Reserve a clear line tail; reveal a complete group name only when it fits.
      const budget = w * 2 / 3;
      const available = budget - 18;
      const first = item.cells[section.start - 1]?.label ?? section.start;
      const last = item.cells[section.end - 1]?.label ?? section.end;
      const range = section.start === section.end ? `(${first})` : `(${first}–${last})`;
      const showRange = item.sectionPadding * k >= size * 2.4 + 4;
      const custom = typeof labelSection === 'function' ? labelSection(section, this) : null;
      if (typeof labelSection === 'function' && !custom) continue;
      const chosen = fitSectionLabel(custom ? { label: String(custom) } : section,
        available, measure, range, showRange && !custom);
      if (!chosen) continue;
      const { name, tail } = chosen;
      const box = {
        x: X(section.x) + 6, y: Y(section.y) - size * 0.6,
        width: measure(name + tail) + 8, height: size * 1.2,
      };
      if (occupied.some((other) => box.x < other.x + other.width + 4 && box.x + box.width + 4 > other.x
        && box.y < other.y + other.height + 4 && box.y + box.height + 4 > other.y)) continue;
      occupied.push(box);

      // The name leads; the range is dimmer still.
      const el = createElement('div', { text: name.toUpperCase() }, this.overlay);
      if (tail) createElement('span', { text: tail, style: 'opacity:0.55' }, el);
      Object.assign(el.style, {
        position: 'absolute',
        left: `${box.x}px`,
        top: `${box.y}px`,
        maxWidth: `${Math.max(20, budget)}px`,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'clip',
        pointerEvents: 'none',
        color: this.partColour('sections', item, this.options.theme.sectionText),
        fontWeight: String(weight),
        background: this.labelBackground(item, section),
        padding: '0 4px',
        fontSize: `${size}px`,
        letterSpacing: '0.06em',
        lineHeight: '1.2',
        opacity: cover?.items.has(section.itemIndex) ? String(faded)
          : String((attention.section === section ? 0.95 : 0.82) * this.labelContext(attention, item, section)),
      });
    }
  }

  destroy() {
    this.cancelGlide();
    this.destroyed = true;
    if (mounted.get(this.container) === this) mounted.delete(this.container);
    this.emit('destroy', this);
    clearTimeout(this.tooltipTimer);
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this.bound?.resize);
    window.removeEventListener('keydown', this.bound?.keydown);
    this.root.remove();
    this.listeners.clear();
  }
}

export function createGridmap(options) {
  return new Gridmap(options);
}
