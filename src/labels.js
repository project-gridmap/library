// Candidates are ordered from richest to simplest. Upgrades need a little
// extra room; the current form stays until it no longer fits.
export function fitLabel(candidates, available, previous, buffer = 6) {
  const previousIndex = candidates.findIndex((candidate) => candidate.key === previous);
  const rank = previousIndex < 0 ? candidates.length : previousIndex;
  return candidates.find((candidate, index) => candidate.width
    + (previous !== undefined && index < rank ? buffer : 0) <= available) ?? null;
}

// Group identity comes first. A range is supplementary detail, and fragments
// of a name are never substituted for a meaningful full or editorial name.
export function fitSectionLabel(section, available, measure, range, showRange) {
  const names = [section.label, section.shortLabel].filter(Boolean);
  const name = names.find((candidate) => measure(candidate.toUpperCase()) <= available);
  if (!name) return null;
  const text = name.toUpperCase();
  const tail = showRange && measure(`${text} ${range}`) + 6 <= available ? ` ${range}` : '';
  return { name: text, tail };
}
