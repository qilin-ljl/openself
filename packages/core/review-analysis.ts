import { parsePatch, isCommentable, annotatePatch } from '@openself/github/diff';
import type { Finding } from '@openself/shared/ai';
export function skipReason(file: { filename: string; patch?: string }) {
  if (!file.patch) return 'no_patch';
  if (
    /(^|\/)(dist|build|vendor)\//.test(file.filename) ||
    /(@generated|DO NOT EDIT)/.test(file.patch.slice(0, 2000))
  )
    return 'generated';
  if (/(^|\/)(pnpm-lock\.yaml|.*-lock\..*|.*\.lock)$|\.min\./.test(file.filename))
    return 'generated';
  return null;
}
export function chunks(patch: string, maxLines = 800) {
  const lines = annotatePatch(patch).split('\n'),
    result: string[] = [];
  let current: string[] = [],
    size = 0;
  for (const raw of lines) {
    const line = raw.slice(0, 4000);
    if (current.length >= maxLines || size + line.length > 60000) {
      result.push(current.join('\n'));
      current = [];
      size = 0;
    }
    current.push(line);
    size += line.length;
  }
  if (current.length) result.push(current.join('\n'));
  return result;
}
const rank = { blocker: 0, major: 1, minor: 2, nit: 3 };
export function cleanFindings(
  findings: Finding[],
  files: { filename: string; patch?: string }[],
  limit = 10,
) {
  const patches = new Map(files.map((f) => [f.filename, parsePatch(f.patch ?? '')]));
  const result: Finding[] = [];
  for (const f of findings
    .filter((f) => f.confidence >= 0.4)
    .sort((a, b) => rank[a.severity] - rank[b.severity] || b.confidence - a.confidence)) {
    const hunks = patches.get(f.path) ?? [];
    if (
      !isCommentable(hunks, f.line, f.side) ||
      (f.startLine &&
        (!hunks.some(
          (h) => isCommentable([h], f.startLine!, f.side) && isCommentable([h], f.line, f.side),
        ) ||
          f.startLine > f.line))
    )
      continue;
    const title = f.title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
    if (
      result.some(
        (r) =>
          r.path === f.path &&
          r.side === f.side &&
          Math.abs(r.line - f.line) <= 3 &&
          (() => {
            const other = r.title
              .toLowerCase()
              .replace(/[^\p{L}\p{N}]+/gu, ' ')
              .trim();
            const a = new Set(title.split(' ')),
              b = new Set(other.split(' '));
            return (
              title === other ||
              (title.length > 5 &&
                other.length > 5 &&
                (title.includes(other) || other.includes(title))) ||
              [...a].filter((v) => b.has(v)).length / Math.max(a.size, b.size) > 0.7
            );
          })(),
      )
    )
      continue;
    result.push(f);
    if (result.length >= limit) break;
  }
  return result;
}
export function repositoryLanguage(readme: string): 'zh' | 'en' {
  const text = readme.replace(/\s/g, '');
  return text.length &&
    [...text].filter((c) => /\p{Script=Han}/u.test(c)).length / text.length > 0.3
    ? 'zh'
    : 'en';
}
