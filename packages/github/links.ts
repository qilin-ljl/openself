import { createHash } from 'node:crypto';
export function pullLineUrl(
  owner: string,
  repo: string,
  number: number,
  path: string,
  line: number,
  side: 'LEFT' | 'RIGHT',
): string {
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pull/${number}/files#diff-${createHash('sha256').update(path).digest('hex')}${side === 'RIGHT' ? 'R' : 'L'}${line}`;
}
