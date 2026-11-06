import { resolveFocus } from '../src/navigation.js';

export function inspectionPath(focus) {
  return ['layer', 'group', 'item', 'section', 'cell']
    .filter((level) => focus[level] && (level !== 'section' || focus.section.label))
    .map((level) => ({ level, entity: focus[level], label: level === 'cell' ? `Chapter ${focus.cell.label}` : focus[level].label }));
}

export function inspectionDetails(model, focus) {
  const count = (n, word) => `${n.toLocaleString('en-GB')} ${word}${n === 1 ? '' : 's'}`;
  if (focus.level === 'cell') {
    const verses = focus.cell.value;
    return Number.isFinite(verses) && verses > 0 ? count(verses, 'verse') : `Chapter ${focus.cell.label}`;
  }
  if (focus.level === 'section') {
    const item = model.items[focus.section.itemIndex];
    const first = item.cells[focus.section.start - 1].label;
    const last = item.cells[focus.section.end - 1].label;
    return first === last ? `Chapter ${first}` : `Chapters ${first}–${last}`;
  }
  if (focus.level === 'item') {
    const groups = focus.item.sections.filter((section) => section.label).length;
    return `${count(focus.item.cellCount, 'chapter')}${groups ? ` · ${count(groups, 'group')}` : ''}`;
  }
  const items = focus.level === 'layer' ? focus.layer.items : focus.level === 'group' ? focus.group.items : model.items;
  return `${count(items.length, 'book')} · ${count(items.reduce((sum, book) => sum + book.cellCount, 0), 'chapter')}`;
}

export function inspectionHash(focus) {
  if (focus.level === 'cell') return `${focus.cell.itemId}.${focus.cell.label}`;
  if (focus.level === 'section') return `${focus.section.itemId}/group/${focus.section.start}-${focus.section.end}`;
  if (focus.level === 'item') return focus.item.id;
  if (focus.level === 'group') return focus.group.id;
  if (focus.level === 'layer') return focus.layer.id;
  return '';
}

export function inspectionFromHash(model, hash) {
  if (!hash) return { level: 'map' };
  const group = /^([^/]+)\/group\/(\d+)-(\d+)$/.exec(hash);
  if (group) {
    const section = model.sections.find((candidate) => candidate.itemId === group[1]
      && candidate.start === Number(group[2]) && candidate.end === Number(group[3]));
    return resolveFocus(model, 'section', section) ?? resolveFocus(model, 'item', group[1]);
  }
  const chapter = /^([^./]+)[./](\d+)$/.exec(hash);
  if (chapter) return resolveFocus(model, 'cell', `${chapter[1]}/${chapter[2]}`);
  for (const level of ['item', 'group', 'layer']) {
    const focus = resolveFocus(model, level, hash);
    if (focus) return focus;
  }
  return { level: 'map' };
}
