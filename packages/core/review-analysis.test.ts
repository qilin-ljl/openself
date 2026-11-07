import { expect, it } from 'vitest';
import { cleanFindings, chunks, skipReason, repositoryLanguage } from './review-analysis';
import type { Finding } from '@openself/shared/ai';
const base: Finding = {
  path: 'a.ts',
  line: 2,
  side: 'RIGHT',
  severity: 'major',
  category: 'bug',
  title: 'Validate input',
  body: 'Missing validation',
  confidence: 0.8,
};
it('drops hallucinated coordinates, weak claims and duplicate nearby findings', () => {
  const result = cleanFindings(
    [
      base,
      { ...base, line: 3, confidence: 0.6 },
      { ...base, path: 'invented.ts' },
      { ...base, line: 99 },
      { ...base, title: 'Different', confidence: 0.2 },
    ],
    [{ filename: 'a.ts', patch: '@@ -0,0 +1,3 @@\n+a\n+b\n+c' }],
  );
  expect(result).toEqual([base]);
});
it('skips generated and binary files and keeps chunk coordinates', () => {
  expect(skipReason({ filename: 'pnpm-lock.yaml', patch: 'x' })).toBe('generated');
  expect(skipReason({ filename: 'a.png' })).toBe('no_patch');
  expect(chunks('@@ -0,0 +1,3 @@\n+a\n+b\n+c', 2).join('\n')).toContain('R3 | +c');
});
it('infers output language from the supplied readme only', () => {
  expect(repositoryLanguage('这是中文项目说明')).toBe('zh');
  expect(repositoryLanguage('A TypeScript project')).toBe('en');
});
