'use strict';

import { DEFAULT_WORLDS, buildGridmapModel, cellAt, normaliseGridmapData } from './model.js';

const DEFAULT_THEME = {
  background: '#0a0b0c',
  text: '#f2efe8',
  mutedText: '#a19d94',
  faintText: '#5c5954',
  cellLine: '#2a2c2e',
  itemLine: '#7d7a74',
  groupLine: '#aeaaa2',
  layerLine: '#d9d5cd',
  font: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};

const DEFAULT_OPTIONS = {
  worlds: DEFAULT_WORLDS,
  layout: 'auto',
  colours: {},
  colourBy: 'item',
  showMarks: true,
  markType: 'number',
  markOpacity: 0.5,
  relativeMarkSize: true,
  markMaxSize: 0.4,
  numberMinPx: 8,
  itemLabels: 'short',
  history: false,
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

const median = (values, fallback = 1) => {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  return sorted.length ? sorted[sorted.length >> 1] : fallback;
};

export class Gridmap {
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
    this.listeners = new Map();
    this.frameRequested = false;
    this.destroyed = false;
    this.pointer = { x: 0, y: 0, inside: false, down: false, moved: false };
    this.resizeObserver = null;

    this.mount();
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
      pointerleave: (event) => this.onPointerLeave(event),
      wheel: (event) => this.onWheel(event),
      keydown: (event) => {
        if (event.key === 'Escape') this.focusMap();
      },
    };

    this.root.addEventListener('pointerdown', this.bound.pointerdown);
    this.root.addEventListener('pointermove', this.bound.pointermove);
    this.root.addEventListener('pointerup', this.bound.pointerup);
    this.root.addEventListener('pointercancel', this.bound.pointerup);
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

  rebuildModels() {
    this.models = {};
    for (const [name, world] of Object.entries(this.options.worlds)) {
      const model = buildGridmapModel(this.data, world);
      model.layout = name;
      this.models[name] = model;
    }
  }

  layoutName() {
    if (this.options.layout !== 'auto') return this.options.layout;
    return this.container.clientHeight > this.container.clientWidth ? 'portrait' : 'landscape';
  }

  useLayout(name) {
    const old = this.model;
    this.model = this.models[name] ?? Object.values(this.models)[0];
    if (old && old !== this.model) {
      const same = (collection, entity) => (entity ? this.model[collection][entity.index] : null);
      this.state.hover = null;
      this.state.selected = same('cells', this.state.selected);
      const focus = this.state.focus;
      this.state.focus = {
        level: focus.level,
        group: same('groups', focus.group),
        item: same('items', focus.item),
        cell: same('cells', focus.cell),
      };
    }
    this.prepareMarks();
    Object.assign(this.camera, this.cameraForFocus(), { free: false });
    this.resize();
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

  resize() {
    if (this.destroyed || !this.model) return;
    const nextLayout = this.layoutName();
    if (nextLayout !== this.model.layout) {
      this.useLayout(nextLayout);
      return;
    }

    const { w, h } = this.viewport();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.dpr = dpr;
    if (!this.camera.free) Object.assign(this.camera, this.cameraForFocus());
    this.render();
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

  addLayer(layer) {
    this.layers.add(layer);
    this.render();
    return () => {
      this.layers.delete(layer);
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
    this.options = mergeOptions({ ...this.options, ...config });
    this.prepareMarks();
    this.render();
  }

  getModel() {
    return this.model;
  }

  getSelectedCell() {
    return this.state.selected;
  }

  colourOf(entity, fallback = this.options.theme.itemLine) {
    const key = this.options.colourBy === 'group' ? entity.groupId
      : this.options.colourBy === 'layer' ? entity.layerId
      : this.options.colourBy === 'cell' ? entity.id
      : entity.itemId ?? entity.id;
    return this.options.colours?.[key] ?? fallback;
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

  frame(rect, fill = 0.92) {
    const { w, h } = this.viewport();
    const margin = Math.min(w, h) < 700 ? 24 : 56;
    const availableW = Math.max(1, w - margin * 2);
    const availableH = Math.max(1, h - margin * 2);
    const k = Math.min(availableW / rect.width, availableH / rect.height, (w * fill) / rect.width, (h * fill) / rect.height);
    return { cx: rect.x + rect.width / 2, cy: rect.y + rect.height / 2, k };
  }

  clampK(k) {
    const min = this.frame(this.model.world).k * 0.55;
    const max = Math.min(this.viewport().w, this.viewport().h) * 0.9 / this.model.cellSide;
    return Math.min(Math.max(k, min), max);
  }

  setCamera(cx, cy, k) {
    const world = this.model.world;
    this.camera.k = this.clampK(k);
    this.camera.cx = Math.min(Math.max(cx, world.x), world.x + world.width);
    this.camera.cy = Math.min(Math.max(cy, world.y), world.y + world.height);
    this.camera.free = true;
    this.render();
  }

  zoomAround(sx, sy, wx, wy, k) {
    k = this.clampK(k);
    this.setCamera(wx - (sx - this.viewport().w / 2) / k, wy - (sy - this.viewport().h / 2) / k, k);
  }

  focusRegion() {
    const focus = this.state.focus;
    if (focus.level === 'cell') return [focus.cell];
    if (focus.level === 'item') return [focus.item];
    if (focus.level === 'group') return focus.group.items;
    return null;
  }

  cameraForFocus() {
    const focus = this.state.focus;
    if (focus.level === 'cell') return this.frame(focus.cell, 0.42);
    if (focus.level === 'item') return this.frame(focus.item, 0.72);
    if (focus.level === 'group') return this.frame(focus.group.bounds, 0.9);
    return this.frame(this.model.world);
  }

  setFocus(level, value = null) {
    const focus = { level };
    if (level === 'group') focus.group = typeof value === 'string'
      ? this.model.groups.find((group) => group.uid === value || group.id === value)
      : value;
    if (level === 'item') focus.item = typeof value === 'string'
      ? this.model.items.find((item) => item.id === value)
      : value;
    if (level === 'cell') focus.cell = typeof value === 'string'
      ? this.model.cells.find((cell) => cell.id === value)
      : value;
    if ((level !== 'map' && !focus[level])) return false;
    if (focus.item) focus.group = this.model.groups[focus.item.groupIndex];
    if (focus.cell) {
      focus.item = this.model.items[focus.cell.itemIndex];
      focus.group = this.model.groups[focus.cell.groupIndex];
    }
    this.state.focus = focus;
    Object.assign(this.camera, this.cameraForFocus(), { free: false });
    this.emit('focusChange', focus);
    this.render();
    return true;
  }

  focusMap() { return this.setFocus('map'); }
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
    if (focus.level === 'item') return cell && cell.itemIndex === focus.item.index ? cell : null;
    if (focus.level === 'group') return cell && cell.groupIndex === focus.group.index ? cell : null;
    return cell;
  }

  onPointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    this.pointer = {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      cam: { ...this.camera },
      inside: true,
      down: true,
      moved: false,
    };
    this.root.setPointerCapture?.(event.pointerId);
  }

  onPointerMove(event) {
    const rect = this.root.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (this.pointer.down) {
      const dx = event.clientX - this.pointer.startX;
      const dy = event.clientY - this.pointer.startY;
      if (Math.hypot(dx, dy) > 4) this.pointer.moved = true;
      if (this.pointer.moved) {
        const cam = this.pointer.cam;
        this.setCamera(cam.cx - dx / cam.k, cam.cy - dy / cam.k, cam.k);
      }
      return;
    }

    const hover = this.hitTest(x, y);
    if (hover !== this.state.hover) {
      this.state.hover = hover;
      this.emit('hoverCell', hover);
      this.render();
    }
    this.showTooltip(hover, x, y);
  }

  onPointerUp(event) {
    if (!this.pointer.down) return;
    const rect = this.root.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const wasTap = !this.pointer.moved;
    this.pointer.down = false;
    if (wasTap) {
      const cell = this.hitTest(x, y);
      if (cell) this.selectCell(cell);
      else this.focusMap();
    }
  }

  onPointerLeave() {
    if (this.pointer.down) return;
    this.state.hover = null;
    this.showTooltip(null);
    this.render();
  }

  onWheel(event) {
    event.preventDefault();
    const rect = this.root.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const dy = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
    this.zoomAround(x, y, this.toWorldX(x), this.toWorldY(y), this.camera.k * Math.exp(-dy * 0.0015));
  }

  showTooltip(cell, x, y) {
    this.tooltip.style.opacity = cell ? '1' : '0';
    if (!cell) return;
    const format = this.options.labels.tooltip;
    this.tooltip.textContent = typeof format === 'function'
      ? format(cell, this)
      : `${cell.groupLabel} / ${cell.itemLabel} / ${cell.label}`;
    const width = this.tooltip.offsetWidth;
    const height = this.tooltip.offsetHeight;
    const { w, h } = this.viewport();
    const left = x + 18 + width > w ? x - 18 - width : x + 18;
    const top = y + 18 + height > h ? y - 18 - height : y + 18;
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
    const onScreen = (r) => X(r.x) < w && X(r.x + r.width) > 0 && Y(r.y) < h && Y(r.y + r.height) > 0;

    ctx.setTransform(this.dpr || 1, 0, 0, this.dpr || 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = 1;
    ctx.setLineDash([]);

    const visibleItems = this.model.items.filter(onScreen);

    const hover = this.state.hover;
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
      ctx.globalAlpha = lineAlpha;
      ctx.strokeStyle = theme.cellLine;
      ctx.beginPath();
      for (const item of visibleItems) for (const cell of item.cells) if (onScreen(cell)) rect(cell);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    for (const item of visibleItems) {
      ctx.strokeStyle = this.colourOf(item, theme.itemLine);
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      rect(item);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    ctx.strokeStyle = theme.groupLine;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    for (const group of this.model.groups) {
      for (const segment of group.outline.filter((sg) => sg.betweenGroups)) {
        ctx.moveTo(X(segment.x1), Y(segment.y1));
        ctx.lineTo(X(segment.x2), Y(segment.y2));
      }
    }
    ctx.stroke();

    ctx.strokeStyle = theme.layerLine;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    this.model.layers.forEach(rect);
    ctx.stroke();

    const selected = this.state.selected;
    if (selected) {
      const item = this.model.items[selected.itemIndex];
      const colour = this.colourOf(selected, theme.text);
      ctx.strokeStyle = colour;
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      rect(item);
      ctx.stroke();

      ctx.strokeStyle = colour;
      ctx.fillStyle = colour;
      ctx.globalAlpha = 0.1;
      ctx.beginPath();
      rect(selected);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      rect(selected);
      ctx.stroke();
    }

    if (this.options.showMarks) this.renderMarks(ctx, X, Y, onScreen);

    for (const layer of this.layers) {
      layer({
        ctx,
        model: this.model,
        state: this.state,
        camera: this.camera,
        rect,
        toScreenX: X,
        toScreenY: Y,
        colourOf: (entity, fallback) => this.colourOf(entity, fallback),
        theme,
      });
    }

    this.renderVeil(ctx, rect);
    this.renderLabels(X, Y);
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

  useNumbers() {
    return this.options.markType === 'number' && this.medianNumberSize * this.camera.k >= this.options.numberMinPx;
  }

  renderMarks(ctx, X, Y, onScreen) {
    const theme = this.options.theme;
    const useNumbers = this.useNumbers();
    const worldK = this.frame(this.model.world).k;
    const dot = Math.min(7, 3 * (this.camera.k / worldK) ** 0.28);
    const damping = useNumbers
      ? Math.min(1, 24 / (this.medianNumberSize * this.camera.k))
      : 1;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const item of this.model.items) {
      ctx.fillStyle = this.colourOf(item, theme.text);
      for (const cell of item.cells) {
        if (!onScreen(cell)) continue;
        const strong = cell === this.state.hover || cell === this.state.selected;
        ctx.globalAlpha = strong ? 1 : this.options.markOpacity;
        if (useNumbers) {
          const size = this.numberWorldSize(cell) * this.camera.k * damping;
          if (size < 2) continue;
          ctx.font = `${strong ? 500 : 400} ${Math.max(2, Math.min(24, size))}px ${theme.font}`;
          ctx.fillText(cell.label, X(cell.centerX), Y(cell.centerY));
        } else {
          const radius = dot * this.markScale(cell) / 2;
          ctx.beginPath();
          ctx.arc(X(cell.centerX), Y(cell.centerY), radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    this.renderMarkEmphasis(ctx, X, Y, useNumbers, dot, damping);
    ctx.globalAlpha = 1;
  }

  renderMarkEmphasis(ctx, X, Y, useNumbers, dot, damping) {
    const hover = this.state.hover;
    const selected = this.state.selected;

    if (!useNumbers && hover) {
      const colour = this.colourOf(hover, this.options.theme.text);
      const radius = dot * this.markScale(hover) / 2;
      ctx.fillStyle = colour;
      ctx.strokeStyle = colour;
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(X(hover.centerX), Y(hover.centerY), radius + 1.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(X(hover.centerX), Y(hover.centerY), radius + 7, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (selected) {
      const colour = this.colourOf(selected, this.options.theme.text);
      const numberSize = this.numberWorldSize(selected) * this.camera.k * damping;
      const numberRadius = Math.max(numberSize * 0.55, String(selected.label).length * 0.6 * numberSize / 2);
      const starRadius = dot * this.markScale(selected) / 2;
      ctx.strokeStyle = colour;
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(X(selected.centerX), Y(selected.centerY), useNumbers ? numberRadius + 5 : starRadius + 6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  renderVeil(ctx, rect) {
    const region = this.focusRegion();
    if (!region) return;
    const { w, h } = this.viewport();
    ctx.fillStyle = this.options.theme.background;
    ctx.globalAlpha = 0.66;
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    region.forEach(rect);
    ctx.fill('evenodd');
    ctx.globalAlpha = 1;
  }

  renderLabels(X, Y) {
    const labelItem = this.options.labels.item;
    const selected = this.state.selected;
    const hover = this.state.hover;
    this.overlay.replaceChildren();

    for (const layer of this.model.layers) {
      const h = layer.height * this.camera.k;
      const text = layer.label.toUpperCase();
      if (h < text.length * 7.5) continue;
      const el = createElement('div', { text }, this.overlay);
      Object.assign(el.style, {
        position: 'absolute',
        left: `${X(layer.x) - 22}px`,
        top: `${Y(layer.y + layer.height / 2)}px`,
        transform: 'translate(-50%, -50%) rotate(-90deg)',
        transformOrigin: 'center',
        color: selected?.layerIndex === layer.index ? this.options.theme.text : this.options.theme.mutedText,
        fontSize: '9.5px',
        letterSpacing: '0.32em',
        whiteSpace: 'nowrap',
      });
    }

    for (const item of this.model.items) {
      const w = item.width * this.camera.k;
      const h = item.height * this.camera.k;
      if (h < 22) continue;
      const full = typeof labelItem === 'function'
        ? labelItem(item, this)
        : this.options.itemLabels === 'full' ? item.label : item.shortLabel;
      const text = `${item.index + 1}.${full}`.toUpperCase();
      const number = String(item.index + 1);
      const label = text.length * 7.3 + 20 <= w ? text : number.length * 7.3 + 14 <= w ? number : null;
      if (!label) continue;

      const el = createElement('div', { text: label }, this.overlay);
      Object.assign(el.style, {
        position: 'absolute',
        left: `${X(item.x) + 5}px`,
        top: `${Y(item.y) - 6}px`,
        maxWidth: `${Math.max(20, w - 8)}px`,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'clip',
        color: this.colourOf(item, this.options.theme.mutedText),
        background: this.options.theme.background,
        padding: '0 4px',
        fontSize: '9px',
        letterSpacing: '0.14em',
        lineHeight: '1.33',
        opacity: selected?.itemIndex === item.index || hover?.itemIndex === item.index ? '1' : '0.72',
      });
    }
  }

  destroy() {
    this.destroyed = true;
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
