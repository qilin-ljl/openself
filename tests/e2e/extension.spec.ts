import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
test('extension authorization uses an origin-bound, single-use code and a separate bearer session', async ({
  page,
  request,
}) => {
  const id = 'a'.repeat(32),
    origin = 'chrome-extension://' + id,
    redirectUri = 'https://' + id + '.chromiumapp.org/';
  await page.request.post('/api/auth/test');
  const start = await page.request.get(
    '/api/extension/authorize?redirect_uri=' +
      encodeURIComponent(redirectUri) +
      '&state=extension-test-state',
    { maxRedirects: 0 },
  );
  expect(start.status()).toBe(307);
  const callback = new URL(start.headers().location!);
  expect(callback.searchParams.get('state')).toBe('extension-test-state');
  const code = callback.searchParams.get('code');
  const token = await request.post('/api/extension/token', {
    headers: { Origin: origin },
    data: { code, redirectUri },
  });
  expect(token.status()).toBe(200);
  expect(token.headers()['access-control-allow-origin']).toBe(origin);
  const auth = await token.json();
  const me = await request.get('/api/me', {
    headers: { Origin: origin, Authorization: 'Bearer ' + auth.token },
  });
  expect(me.status()).toBe(200);
  expect((await me.json()).login).toBe('test-contributor');
  expect(
    (
      await request.get('/api/me', {
        headers: { Origin: 'https://evil.test', Authorization: 'Bearer ' + auth.token },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post('/api/extension/token', {
        headers: { Origin: origin },
        data: { code, redirectUri },
      })
    ).status(),
  ).toBe(400);
  await request.post('/api/extension/logout', {
    headers: { Origin: origin, Authorization: 'Bearer ' + auth.token },
  });
  expect(
    (
      await request.get('/api/me', {
        headers: { Origin: origin, Authorization: 'Bearer ' + auth.token },
      })
    ).status(),
  ).toBe(401);
});
test('issue filling uses native value setters and never clicks submit', async ({ page }) => {
  await page.setContent(
    '<form><input name="issue[title]"><textarea name="issue[body]"></textarea><button type="submit">Submit</button></form>',
  );
  const source = await readFile('apps/extension/lib/fill-issue.ts', 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const result = await page.evaluate(async (source) => {
    let submitted = 0,
      inputs = 0;
    document.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      submitted++;
    });
    document.addEventListener('input', () => inputs++);
    const module = await import('data:text/javascript;base64,' + btoa(source));
    const ok = module.fillIssueInputs(document, {
      title: 'A clear issue',
      body: 'Steps to reproduce',
    });
    return {
      ok,
      submitted,
      inputs,
      title: document.querySelector('input')!.value,
      body: document.querySelector('textarea')!.value,
    };
  }, js);
  expect(result).toEqual({
    ok: true,
    submitted: 0,
    inputs: 2,
    title: 'A clear issue',
    body: 'Steps to reproduce',
  });
});
