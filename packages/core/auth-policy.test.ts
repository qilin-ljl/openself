import { describe, expect, it } from 'vitest';
import { safeNext, validOrigin, validState } from './auth-policy';
describe('OAuth request boundaries', () => {
  it('preserves a local destination and its query string', () => {
    expect(safeNext('/en/dashboard?tab=drafts')).toBe('/en/dashboard?tab=drafts');
  });
  it.each([
    'https://evil.test',
    '//evil.test',
    '/\\evil.test',
    '/%5Cevil.test',
    '/%2f%2fevil.test',
    '/zh\n/evil',
    '/api/auth/github/login',
    '/%2565vil',
    'javascript:alert(1)',
  ])('rejects unsafe next=%s', (value) => {
    expect(safeNext(value)).toBe('/zh/dashboard');
  });
  it('requires both OAuth states and an exact match', () => {
    expect(validState('a'.repeat(32), 'a'.repeat(32))).toBe(true);
    expect(validState('a'.repeat(32), 'b'.repeat(32))).toBe(false);
    expect(validState(undefined, null)).toBe(false);
    expect(validState('', '')).toBe(false);
  });
  it('rejects missing and cross-site origins for cookie writes', () => {
    expect(validOrigin('https://app.test', 'https://app.test')).toBe(true);
    expect(validOrigin('https://evil.test', 'https://app.test')).toBe(false);
    expect(validOrigin(null, 'https://app.test')).toBe(false);
    expect(validOrigin('https://app.test.evil.test', 'https://app.test')).toBe(false);
  });
});
