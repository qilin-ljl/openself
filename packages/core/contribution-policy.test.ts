import { expect, it } from 'vitest';
import {
  applySourceEdits,
  assertContributionPath,
  sourceSkipReason,
  matchesEvidence,
} from './contribution-policy';

it.each([
  '../secret.ts',
  '/tmp/a.ts',
  'C:/a.ts',
  'src\\a.ts',
  'src//a.ts',
  'src/./a.ts',
  '.git/config',
  '.github/workflows/ci.yml',
  '.env',
  'src/.env.production',
  '.npmrc',
  'id_rsa',
  'vendor/library.ts',
  'node_modules/lib/index.js',
])('rejects protected contribution path %s', (path) => {
  expect(() => assertContributionPath(path)).toThrow();
});
it('accepts ordinary source, test and documentation paths', () => {
  for (const path of [
    'src/math.ts',
    'tests/test_math.py',
    'docs/usage.md',
    '.github/ISSUE_TEMPLATE/bug.yml',
  ])
    expect(() => assertContributionPath(path)).not.toThrow();
});
it('applies a unique edit while preserving the original line ending style', () => {
  expect(
    applySourceEdits('function run() {\r\n  return 0;\r\n}\r\n', [
      { original: '  return 0;', replacement: '  return 1;' },
    ]),
  ).toBe('function run() {\r\n  return 1;\r\n}\r\n');
});
it('refuses absent or ambiguous edit contexts instead of modifying an arbitrary occurrence', () => {
  expect(() => applySourceEdits('a\na\n', [{ original: 'a', replacement: 'b' }])).toThrow();
  expect(() => applySourceEdits('a\n', [{ original: 'missing', replacement: 'b' }])).toThrow();
  expect(() => applySourceEdits('a\n', [{ original: '', replacement: 'b' }])).toThrow();
});
it('excludes symlinks, large/generated files and potential credentials from AI source reads', () => {
  expect(sourceSkipReason({ path: 'src/a.ts', mode: '120000', size: 10 })).toBe('non_regular_file');
  expect(sourceSkipReason({ path: 'package-lock.json', mode: '100644', size: 20 })).toBe(
    'generated',
  );
  expect(sourceSkipReason({ path: 'src/a.ts', mode: '100644', size: 200001 })).toBe('too_large');
  expect(sourceSkipReason({ path: '.env.example', mode: '100644', size: 50 })).toBe(
    'protected_path',
  );
  expect(
    sourceSkipReason(
      { path: 'src/a.ts', mode: '100644', size: 20 },
      'const key = "sk-' + 'x'.repeat(30) + '";',
    ),
  ).toBe('sensitive_content');
});
it('requires evidence to match code at the reported line', () => {
  const code = 'function read(x) {\n  return x.value;\n}\n';
  expect(matchesEvidence(code, 2, 'return x.value;')).toBe(true);
  expect(matchesEvidence(code, 3, 'return x.value;')).toBe(false);
  expect(matchesEvidence(code, 99, 'return x.value;')).toBe(false);
  expect(matchesEvidence(code, 2, 'throw new Error()')).toBe(false);
});
