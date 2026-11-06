const collections = { layer: 'layers', group: 'groups', item: 'items', section: 'sections', cell: 'cells' };

export function resolveFocus(model, level, value = null) {
  if (level === 'map') return { level };
  const collection = model[collections[level]];
  if (!collection || value == null) return null;
  const key = typeof value === 'object' && value ? value.uid ?? value.id : value;
  const entity = collection.find((candidate) => candidate === value
    || (key != null && (typeof key === 'number' ? candidate.index === key : candidate.uid === key || candidate.id === key)));
  if (!entity) return null;
  const focus = { level, [level]: entity };
  if (focus.cell) {
    focus.item = model.items[focus.cell.itemIndex];
    focus.section = model.sections[focus.cell.sectionIndex] ?? null;
  }
  if (focus.section) focus.item = model.items[focus.section.itemIndex];
  if (focus.item) focus.group = model.groups[focus.item.groupIndex];
  if (focus.group) focus.layer = model.layers[focus.group.layerIndex];
  return focus;
}

export function parentFocus(model, focus) {
  const parent = focus.level === 'cell' ? (focus.section?.label ? 'section' : 'item')
    : focus.level === 'section' ? 'item' : focus.level === 'item' ? 'group'
      : focus.level === 'group' ? 'layer' : 'map';
  return resolveFocus(model, parent, focus[parent]) ?? { level: 'map' };
}

// Rebind by identity after a responsive layout/data rebuild. If a level no
// longer exists (for example sections were turned off), use its nearest parent.
export function rebindFocus(model, focus) {
  for (const level of [focus.level, 'section', 'item', 'group', 'layer']) {
    if (focus[level]) {
      const resolved = resolveFocus(model, level, focus[level]);
      if (resolved) return resolved;
    }
  }
  return { level: 'map' };
}
