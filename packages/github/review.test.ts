import { expect, it } from 'vitest';
import { normalizeComments } from './review';
const files = [
  { filename: 'src.ts', patch: '@@ -1,2 +1,2 @@\n same\n-old\n+new' },
  { filename: 'image.png' },
];
it('moves unavailable lines to the summary instead of posting an invalid coordinate', () => {
  const result = normalizeComments(files, 'Summary', [
    { path: 'src.ts', line: 2, side: 'RIGHT', body: 'Valid comment' },
    { path: 'image.png', line: 1, side: 'RIGHT', body: 'Inspect this asset' },
    { path: 'src.ts', line: 8, side: 'LEFT', body: 'Outside hunk' },
  ]);
  expect(result.comments).toHaveLength(1);
  expect(result.body).toContain('image.png:1');
  expect(result.body).toContain('Outside hunk');
});
it('rejects a multi-line range crossing a missing hunk', () => {
  const result = normalizeComments(
    [{ filename: 'x', patch: '@@ -1 +1 @@\n a\n@@ -8 +8 @@\n b' }],
    '',
    [{ path: 'x', startLine: 1, line: 8, side: 'RIGHT', body: 'A range' }],
  );
  expect(result.comments).toEqual([]);
  expect(result.body).toContain('A range');
});
