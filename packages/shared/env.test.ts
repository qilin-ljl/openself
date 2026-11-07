import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';
const valid = {
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://test:test@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  GITHUB_CLIENT_ID: 'test-client',
  GITHUB_CLIENT_SECRET: 'test-secret',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};
describe('startup configuration', () => {
  it('starts without a server AI key because keys belong to users', () => {
    expect(parseEnv(valid)).toMatchObject({
      APP_URL: valid.APP_URL,
      SESSION_COOKIE_NAME: 'os_session',
      REVIEW_MAX_FILES: 100,
    });
  });
  it.each([
    'DATABASE_URL',
    'REDIS_URL',
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
    'ENCRYPTION_KEY',
  ])('requires %s', (name) => {
    expect(() => parseEnv({ ...valid, [name]: '' })).toThrow();
  });
  it('rejects invalid encryption key lengths, nonpositive file limits and non-HTTPS production', () => {
    expect(() => parseEnv({ ...valid, ENCRYPTION_KEY: 'abcd' })).toThrow();
    expect(() => parseEnv({ ...valid, REVIEW_MAX_FILES: '0' })).toThrow();
    expect(() => parseEnv({ ...valid, NODE_ENV: 'production' })).toThrow();
  });
  it('does not expose secret values in validation errors', () => {
    try {
      parseEnv({ ...valid, ENCRYPTION_KEY: 'do-not-log-me' });
    } catch (error) {
      expect(String(error)).not.toContain('do-not-log-me');
    }
  });
});
