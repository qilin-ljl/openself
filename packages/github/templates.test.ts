import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseTemplate, parseTemplateConfig, buildFormBody } from './templates';
const fixture = (name: string) =>
  readFileSync(new URL('./test/fixtures/' + name, import.meta.url), 'utf8');
describe('GitHub issue templates', () => {
  it('preserves Markdown metadata and the editable body', () => {
    expect(parseTemplate('bug.md', fixture('bug.md'))).toMatchObject({
      kind: 'markdown',
      name: 'Bug report',
      labels: ['bug', 'triage'],
      body: '## Steps to reproduce\n\n## Expected behavior\n',
    });
  });
  it('handles all five GitHub form field types', () => {
    expect(parseTemplate('bug.yml', fixture('bug.yml'))?.fields?.map((f) => f.type)).toEqual([
      'markdown',
      'input',
      'textarea',
      'dropdown',
      'checkboxes',
    ]);
  });
  it('does not offer config.yml as a template and respects disabled blank issues', () => {
    expect(parseTemplate('config.yml', fixture('config.yml'))).toBeNull();
    expect(parseTemplateConfig(fixture('config.yml'))).toEqual({ blankIssuesEnabled: false });
  });
  it('renders answers as Markdown without including display-only instructions', () => {
    const t = parseTemplate('bug.yml', fixture('bug.yml'))!;
    expect(
      buildFormBody(t, {
        version: '1.2',
        steps: 'Open the app',
        os: 'Windows',
        checklist: ['I searched existing issues'],
      }),
    ).toBe(
      '### Version\n\n1.2\n\n### Steps\n\nOpen the app\n\n### Operating system\n\nWindows\n\n### Checklist\n\n- [x] I searched existing issues\n- [ ] I can reproduce the bug\n',
    );
  });
  it('requires mandatory answers and required checkbox options', () => {
    const t = parseTemplate('bug.yml', fixture('bug.yml'))!;
    expect(() => buildFormBody(t, { version: '', steps: 'x', os: 'Windows' })).toThrow();
    expect(() =>
      buildFormBody(t, { version: '1', steps: 'x', os: 'Windows', checklist: [] }),
    ).toThrow();
  });
  it('rejects a dropdown value that is not an offered option', () => {
    const t = parseTemplate('bug.yml', fixture('bug.yml'))!;
    expect(() =>
      buildFormBody(t, {
        version: '1',
        steps: 'x',
        os: 'invented',
        checklist: ['I searched existing issues'],
      }),
    ).toThrow();
  });
});
