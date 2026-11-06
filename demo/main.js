import { createGridmap } from '../src/index.js';
import { bibleToGridmapData, bibleReference } from './adapters/bible-gridmap-adapter.js';
import { bibleGameOptions } from './bible-game-config.js';
import { refineMapAppearance } from './appearance.js';

const $ = (id) => document.getElementById(id);
const mobile = matchMedia('(max-width: 699px)');
const coarse = matchMedia('(pointer: coarse)');
let map;
let currentFocus = { level: 'map' };
let applyingHash = false;

function action(text, callback, parent) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = text;
  button.onclick = callback;
  parent.appendChild(button);
}

function renderChrome() {
  const crumbs = $('crumbs');
  crumbs.replaceChildren();
  action('Project Gridmap', () => map.focusMap(), crumbs);
  const entries = [];
  if (currentFocus.group) entries.push([currentFocus.group.label, () => map.focusGroup(currentFocus.group)]);
  if (currentFocus.item) entries.push([currentFocus.item.label, () => map.focusItem(currentFocus.item)]);
  if (currentFocus.cell) entries.push([`Chapter ${currentFocus.cell.label}`, () => map.focusCell(currentFocus.cell)]);
  for (const [label, go] of entries) {
    const separator = document.createElement('span');
    separator.textContent = '/';
    crumbs.appendChild(separator);
    action(label, go, crumbs);
  }
  const info = $('info');
  info.replaceChildren();
  const selected = map.getSelectedCell();
  if (!selected) return;
  action(selected.groupLabel, () => map.focusGroup(map.getModel().groups[selected.groupIndex]), info);
  info.append(' / ');
  action(selected.itemLabel, () => map.focusItem(selected.itemId), info);
  info.append(' / ');
  action(`Chapter ${selected.label}`, () => map.focusCell(selected.id), info);
  info.lastChild.classList.add('selected');
  info.setAttribute('aria-label', bibleReference(selected));
}

function focusHash(focus) {
  if (focus.cell) return `${focus.cell.itemId}.${focus.cell.label}`;
  if (focus.item) return focus.item.id;
  if (focus.group) return focus.group.id;
  return '';
}

function applyHash() {
  applyingHash = true;
  try {
    const hash = decodeURIComponent(location.hash.slice(1));
    const chapter = /^([^./]+)[./](\d+)$/.exec(hash);
    if (chapter) {
      const id = `${chapter[1]}/${chapter[2]}`;
      if (map.focusCell(id)) map.selectCell(id);
    } else if (hash) {
      if (!map.focusItem(hash)) map.focusGroup(hash);
    } else map.focusMap();
  } catch {
    map.focusMap();
  } finally {
    applyingHash = false;
  }
}

async function start() {
  const load = async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return response.json();
  };
  const [bible, colours, groups] = await Promise.all([
    load('./bible.json'), load('./colours.json'), load('./groups.json'),
  ]);
  const options = bibleGameOptions(colours, { mobile: mobile.matches });
  map = createGridmap({
    ...refineMapAppearance(options),
    container: $('map'),
    data: bibleToGridmapData(bible, groups),
  });
  // Selection stays separate from focus, as in the app. The reference buttons
  // let the demo inspect a division, book or chapter explicitly.
  map.on('selectCell', renderChrome);
  map.on('focusChange', (focus) => {
    currentFocus = focus;
    if (!applyingHash) {
      const hash = focusHash(focus);
      history.pushState(null, '', `${location.pathname}${location.search}${hash ? `#${hash}` : ''}`);
    }
    renderChrome();
  });
  mobile.addEventListener('change', () => map.setConfig({ numberMinPx: mobile.matches ? 10 : 8 }));
  addEventListener('popstate', applyHash);
  addEventListener('hashchange', applyHash);
  $('hint').textContent = coarse.matches
    ? 'tap to select · pinch to zoom · tap reference to focus'
    : 'click to select · scroll to zoom · click reference to focus · esc to return';
  renderChrome();
  applyHash();
  document.fonts?.load(`500 12px ${options.theme.font}`).then(() => map.setColours(colours)).catch(() => {});
}

start().catch((error) => {
  console.error(error);
  $('info').textContent = location.protocol === 'file:'
    ? 'Serve this folder locally: python3 -m http.server'
    : `Could not load map data: ${error.message}`;
});
