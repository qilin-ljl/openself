import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { encrypt, decrypt } from './crypto';
describe('credential encryption', () => {
  const key = randomBytes(32).toString('base64');
  it('round trips unicode credentials without storing plaintext', () => {
    const value = 'gho_private-令牌';
    const encrypted = encrypt(value, key);
    expect(encrypted).not.toContain(value);
    expect(decrypt(encrypted, key)).toBe(value);
  });
  it('uses a fresh IV for every encryption', () => {
    expect(encrypt('secret', key)).not.toBe(encrypt('secret', key));
  });
  it('rejects modified ciphertext and authentication tags', () => {
    const encrypted = encrypt('a test credential', key).split('.');
    for (const index of [0, 1, 2]) {
      const parts = [...encrypted];
      const bytes = Buffer.from(parts[index]!, 'base64');
      bytes[0] = bytes[0]! ^ 1;
      parts[index] = bytes.toString('base64');
      expect(() => decrypt(parts.join('.'), key)).toThrow();
    }
  });
  it('rejects the wrong key, malformed data and non-256-bit keys', () => {
    expect(() => decrypt(encrypt('secret', key), randomBytes(32).toString('base64'))).toThrow();
    expect(() => decrypt('bad', key)).toThrow();
    expect(() => encrypt('secret', 'bad')).toThrow();
  });
});
