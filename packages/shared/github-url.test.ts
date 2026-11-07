import { expect, it } from 'vitest';
import { parseGitHubUrl, githubLineUrl } from './github-url';
it('recognizes supported GitHub pages without accepting lookalike hosts', () => {
  expect(parseGitHubUrl('https://github.com/o/r/pull/12/files')).toEqual({
    kind: 'pr',
    owner: 'o',
    repo: 'r',
    number: 12,
  });
  expect(parseGitHubUrl('https://github.com/o/r/issues/new?template=bug.yml')?.kind).toBe('issue');
  expect(parseGitHubUrl('https://github.com.evil.test/o/r')).toBeNull();
  expect(parseGitHubUrl('https://github.com/o/r/actions')).toBeNull();
});
it('builds a browser-compatible code-line anchor', async () => {
  expect(await githubLineUrl('o', 'r', 3, 'abc', 2, 'RIGHT')).toBe(
    'https://github.com/o/r/pull/3/files#diff-ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015adR2',
  );
});
