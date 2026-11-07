import { timingSafeEqual } from 'node:crypto';
export function safeNext(value: string | null | undefined, fallback = '/zh/dashboard'): string {
  if (
    !value ||
    !/^\/(zh|en)(\/|\?|$)/.test(value) ||
    [...value].some((char) => char.charCodeAt(0) < 32 || char === '\\') ||
    /%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|25)/i.test(value.split(/[?#]/)[0] ?? '')
  )
    return fallback;
  const url = new URL(value, 'https://local.invalid');
  if (url.origin !== 'https://local.invalid' || !/^\/(zh|en)(\/|$)/.test(url.pathname))
    return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
export function validState(expected: string | undefined, actual: string | null): boolean {
  if (!expected || !actual) return false;
  const a = Buffer.from(expected),
    b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function validOrigin(origin: string | null, appUrl: string): boolean {
  return origin !== null && origin === new URL(appUrl).origin;
}
