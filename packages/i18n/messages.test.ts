import { expect, it } from 'vitest';
import zh from './zh.json';
import en from './en.json';
function keys(value: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(value)
    .flatMap(([key, item]) =>
      typeof item === 'object' && item
        ? keys(item as Record<string, unknown>, `${prefix}${key}.`)
        : [`${prefix}${key}`],
    )
    .sort();
}
it('provides the same translation keys in both languages', () =>
  expect(keys(zh)).toEqual(keys(en)));
