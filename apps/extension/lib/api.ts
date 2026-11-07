import { browser } from 'wxt/browser';
export const APP_URL = (import.meta.env.WXT_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
export class ApiError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const { auth } = await browser.storage.local.get('auth');
  const token = (auth as { token?: string } | undefined)?.token;
  if (!token) throw new ApiError('unauthorized');
  const response = await fetch(APP_URL + path, {
    ...init,
    credentials: 'omit',
    redirect: 'error',
    headers: {
      'X-OpenSelf-Extension': browser.runtime.id,
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
      ...init?.headers,
    },
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) await browser.storage.local.remove('auth');
    throw new ApiError(result.error?.code ?? 'unknown');
  }
  return result;
}
