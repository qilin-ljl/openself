import { expect, it } from 'vitest';
import { pullLineUrl } from './links';
it('uses SHA-256 of the path and the requested diff side', () => {
  expect(pullLineUrl('o', 'r', 3, 'abc', 9, 'RIGHT')).toBe(
    'https://github.com/o/r/pull/3/files#diff-ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015adR9',
  );
  expect(pullLineUrl('o', 'r', 3, 'abc', 2, 'LEFT')).toMatch(/L2$/);
});
