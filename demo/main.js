import { createGridmap } from '../src/index.js';
import { resolveFocus } from '../src/navigation.js';
import { bibleToGridmapData } from './adapters/bible-gridmap-adapter.js';
import { bibleGameOptions } from './bible-game-config.js';
import { refineMapAppearance } from './appearance.js';
import { inspectionDetails, inspectionFromHash, inspectionHash, inspectionPath } from './inspection.js';

const $ = (id) => document.getElementById(id);
const mobile = matchMedia('(max-width: 699px)');
const coarse = matchMedia('(pointer: coarse)');
let map;
let persistent = { level: 'map' };
let preview = null;
let applyingHash = false;
let previewTimer;
let historyHash = null;

function inspect(focus) {
  map.setFocus(focus.level, focus[focus.level]);
}

function action(entry, parent) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = entry.label;
  button.dataset.inspectKey = `${entry.level}:${entry.entity.uid ?? entry.entity.id}`;
  button.onclick = () => inspect(resolveFocus(map.getModel(), entry.level, entry.entity) ?? { level: 'map' });
  parent.appendChild(button);
  return button;
}

function renderBreadcrumbs() {
  const crumbs = $('crumbs');
  const focusedKey = crumbs.contains(document.activeElement) ? document.activeElement.dataset.inspectKey : null;
  crumbs.replaceChildren();
  const root = document.createElement('button');
  root.dataset.inspectKey = 'map'; root.type = 'button'; root.textContent = 'Project Gridmap'; root.onclick = () => map.focusMap();
  crumbs.appendChild(root);
  for (const entry of inspectionPath(map.getFocus())) {
    const separator = document.createElement('span'); separator.textContent = '/'; crumbs.appendChild(separator);
    action(entry, crumbs);
  }
  crumbs.lastElementChild?.setAttribute('aria-current', 'location');
  crumbs.scrollLeft = crumbs.scrollWidth;
  if (focusedKey) [...crumbs.querySelectorAll('button')].find((button) => button.dataset.inspectKey === focusedKey)?.focus({ preventScroll: true });
}

function currentInspection() {
  const source = preview ?? persistent;
  return resolveFocus(map.getModel(), source.level, source[source.level]) ?? map.getFocus();
}

function renderInspector({ alignFocus = false } = {}) {
  const info = $('info');
  let focusedKey = info.contains(document.activeElement) ? document.activeElement.dataset.inspectKey : null;
  const inspection = currentInspection();
  const model = map.getModel();
  info.setAttribute('aria-live', preview ? 'off' : 'polite');
  info.replaceChildren();
  const path = document.createElement('div'); path.className = 'path';
  const facts = document.createElement('div'); facts.className = 'facts';
  const selected = map.getSelectedCell();
  const summary = inspectionDetails(model, inspection);
  function showDetails(focus = inspection) {
    facts.replaceChildren();
    if (selected && (focus.level !== 'cell' || focus.cell.id !== selected.id)) {
      const entry = { level: 'cell', entity: selected, label: `Selected ${selected.itemShortLabel} ${selected.label}` };
      action(entry, facts).classList.add('selected'); facts.append(' · ');
    }
    const subject = inspectionPath(focus).at(-1);
    if (inspectionHash(focus) !== inspectionHash(inspection) && subject) facts.append(`${subject.label} · `);
    facts.append(inspectionDetails(model, focus));
    facts.title = facts.textContent;
  }
  const entries = inspection.level === 'map'
    ? model.layers.map((layer) => ({ level: 'layer', entity: layer, label: layer.label }))
    : inspectionPath(inspection);
  entries.forEach((entry, index) => {
    if (index) { const separator = document.createElement('span'); separator.textContent = '/'; path.appendChild(separator); }
    const button = action(entry, path);
    button.onfocus = () => showDetails(resolveFocus(model, entry.level, entry.entity));
    button.onblur = () => showDetails();
    button.onmouseenter = button.onfocus;
    button.onmouseleave = () => { if (document.activeElement !== button) showDetails(); };
  });
  if (alignFocus && focusedKey && entries.length) {
    const last = entries.at(-1);
    focusedKey = `${last.level}:${last.entity.uid ?? last.entity.id}`;
  }
  showDetails();
  info.append(path, facts);
  info.setAttribute('aria-label', `${entries.map((entry) => entry.label).join(' / ')}. ${summary}`);
  const restore = [...info.querySelectorAll('[data-inspect-key]')].find((button) => button.dataset.inspectKey === focusedKey);
  if (restore) restore.focus({ preventScroll: true });
  else path.scrollLeft = path.scrollWidth;
}

function applyHash(selectChapter = false) {
  applyingHash = true;
  try {
    const focus = inspectionFromHash(map.getModel(), decodeURIComponent(location.hash.slice(1))) ?? { level: 'map' };
    inspect(focus);
    if (selectChapter && focus.level === 'cell') map.selectCell(focus.cell);
  } catch { map.focusMap(); }
  finally { applyingHash = false; }
}

async function start() {
  const load = async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return response.json();
  };
  const [bible, colours, groups] = await Promise.all([load('./bible.json'), load('./colours.json'), load('./groups.json')]);
  const options = bibleGameOptions(colours, { mobile: mobile.matches });
  map = createGridmap({ ...refineMapAppearance(options), semanticZoom: true,
    container: $('map'), data: bibleToGridmapData(bible, groups) });
  map.on('dataChange', () => { persistent = map.getFocus(); renderBreadcrumbs(); renderInspector(); });
  map.on('selectCell', (cell) => { clearTimeout(previewTimer); preview = null; persistent = resolveFocus(map.getModel(), 'cell', cell); renderInspector({ alignFocus: true }); });
  map.on('hoverCell', (cell) => {
    clearTimeout(previewTimer);
    if (coarse.matches || $('info').contains(document.activeElement)) return;
    if (!cell) {
      previewTimer = setTimeout(() => {
        if ($('info').matches(':hover') || $('info').contains(document.activeElement)) return;
        preview = null; renderInspector();
      }, 150);
      return;
    }
    preview = resolveFocus(map.getModel(), 'cell', cell);
    renderInspector();
  });
  map.on('focusChange', (focus) => {
    clearTimeout(previewTimer);
    preview = null; persistent = focus;
    const hash = inspectionHash(focus);
    if (!applyingHash && encodeURI(hash) !== location.hash.slice(1)) {
      history.pushState(null, '', `${location.pathname}${location.search}${hash ? `#${hash}` : ''}`);
    }
    renderBreadcrumbs(); renderInspector({ alignFocus: true });
  });
  // Leaving the map for its reference area keeps the preview available to click.
  $('info').addEventListener('mouseleave', () => {
    if (!preview || $('info').contains(document.activeElement)) return;
    preview = null; renderInspector();
  });
  mobile.addEventListener('change', () => map.setConfig({ numberMinPx: mobile.matches ? 10 : 8 }));
  addEventListener('popstate', () => { historyHash = location.href; applyHash(); });
  addEventListener('hashchange', () => {
    const fromHistory = historyHash === location.href; historyHash = null;
    if (!fromHistory) applyHash(true);
  });
  $('hint').textContent = coarse.matches ? 'Pinch to zoom · tap a reference'
    : 'Scroll to zoom · references to inspect · Esc to step out';
  applyHash(true);
  document.fonts?.load(`500 12px ${options.theme.font}`).then(() => map.setColours(colours)).catch(() => {});
}

start().catch((error) => {
  console.error(error);
  $('info').textContent = location.protocol === 'file:' ? 'Serve this folder locally: python3 -m http.server'
    : `Could not load map data: ${error.message}`;
});
