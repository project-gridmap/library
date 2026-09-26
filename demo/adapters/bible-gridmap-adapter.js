'use strict';

const slug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function bibleToGridmapData(bible) {
  return {
    meta: { source: 'bible' },
    layers: bible.testaments.map((testament) => ({
      id: `${testament.name.toLowerCase()}-testament`,
      label: `${testament.name} Testament`,
      groups: testament.divisions.map((division) => ({
        id: slug(division.name),
        label: division.name,
        items: division.books.map((book) => ({
          id: book.key,
          label: book.name,
          shortLabel: book.key,
          cells: Array.from({ length: book.chapters }, (_, index) => ({
            id: `${book.key}.${index + 1}`,
            label: String(index + 1),
            value: book.verses?.[index] ?? null,
            meta: {
              verses: book.verses?.[index] ?? null,
              icon: book.icons?.[index] ?? null,
              reference: `${book.name} ${index + 1}`,
            },
          })),
          meta: {
            original: book,
          },
        })),
      })),
    })),
  };
}

export function bibleReference(cell) {
  const book = cell.itemLabel === 'Psalms' ? 'Psalm' : cell.itemLabel;
  return `${book} ${cell.label}`;
}
