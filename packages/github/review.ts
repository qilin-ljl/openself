export type ReviewComment = {
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  startLine?: number;
  body: string;
  findingId?: string;
};
import { parsePatch, isCommentable } from './diff';
export function normalizeComments(
  files: { filename: string; patch?: string }[],
  body: string,
  comments: ReviewComment[],
) {
  const kept: ReviewComment[] = [];
  const summaries: string[] = [];
  const byPath = new Map(files.map((f) => [f.filename, parsePatch(f.patch ?? '')]));
  for (const c of comments) {
    const hunks = byPath.get(c.path) ?? [];
    const start = c.startLine ?? c.line;
    const valid =
      Number.isInteger(start) &&
      Number.isInteger(c.line) &&
      start > 0 &&
      start <= c.line &&
      c.line - start < 1000 &&
      hunks.some((h) => isCommentable([h], start, c.side) && isCommentable([h], c.line, c.side));
    if (valid) kept.push(c);
    else summaries.push(`### ${c.path}:${c.line} (${c.side})\n\n${c.body}`);
  }
  return { body: [body, ...summaries].filter(Boolean).join('\n\n'), comments: kept };
}
