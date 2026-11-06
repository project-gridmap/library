'use strict';

const slug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function bibleToGridmapData(bible, chapterGroups = {}) {
  return {
    meta: { source: 'bible' },
    layers: bible.testaments.map((testament) => ({
      id: slug(testament.name),
      label: testament.name,
      groups: testament.divisions.map((division) => ({
        id: slug(division.name),
        label: division.name,
        items: division.books.map((book) => ({
          id: book.key,
          label: book.name,
          shortLabel: book.key,
          sections: (chapterGroups[book.name.toLowerCase()]
            ?? chapterGroups[{ matthew: 'mathew' }[book.name.toLowerCase()]])
            ?.map(({ name: label, start, end }) => ({ label, start, end })),
          cells: Array.from({ length: book.chapters }, (_, index) => ({
            id: `${book.key}/${index + 1}`,
            label: String(index + 1),
            value: Number(book.verses?.[index]) || null,
            meta: {
              verses: book.verses?.[index] ?? null,
              icon: book.icons?.[index] ?? null,
              reference: `${book.name} ${index + 1}`,
              bookKey: book.key,
              bookName: book.name,
              chapter: index + 1,
              division: division.name,
              testament: testament.name,
            },
          })),
          meta: {
            original: book,
            bookName: book.name,
            division: division.name,
            testament: testament.name,
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
