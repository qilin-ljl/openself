import { NextResponse } from 'next/server';
export function apiError(code: string, status: number) {
  return NextResponse.json(
    { error: { code, message: code } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}
export function cookieOptions(secure: boolean) {
  return { httpOnly: true, secure, sameSite: 'lax' as const, path: '/' };
}
