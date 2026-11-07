import { expect, it } from 'vitest';
import { topLanguages, rankRadar } from './radar';
it('ranks the three most used languages without inventing missing languages', () => {
  expect(
    topLanguages([
      { language: 'Python' },
      { language: 'TypeScript' },
      { language: 'Python' },
      { language: null },
      { language: 'Rust' },
      { language: 'Go' },
    ]),
  ).toEqual(['Python', 'Go', 'Rust']);
});
it('deduplicates recommendations and retains five most recently updated issues', () => {
  const items = Array.from({ length: 8 }, (_, i) => ({
    number: i,
    title: 'Issue ' + i,
    url: 'https://github.com/o/r/issues/' + i,
    repo: 'o/r',
    language: 'TypeScript',
    updatedAt: '2026-11-0' + i,
  }));
  expect(rankRadar([...items, items[7]!]).map((i) => i.number)).toEqual([7, 6, 5, 4, 3]);
});
