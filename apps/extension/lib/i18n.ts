import zh from '@openself/i18n/zh';
import en from '@openself/i18n/en';
function lookup(value: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce(
      (obj, key) =>
        obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined,
      value,
    );
}
export function translate(
  locale: 'zh' | 'en',
  key: string,
  values: Record<string, string | number> = {},
) {
  const value = lookup(locale === 'zh' ? zh : en, key) ?? lookup(en, key);
  if (typeof value !== 'string') return key;
  let output = value;
  for (const [k, v] of Object.entries(values)) output = output.replaceAll('{' + k + '}', String(v));
  return output;
}
