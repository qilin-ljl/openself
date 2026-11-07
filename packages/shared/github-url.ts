export type GitHubTarget = {
  kind: 'repo' | 'issue' | 'pr';
  owner: string;
  repo: string;
  number?: number;
};
export function parseGitHubUrl(value: string): GitHubTarget | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com') return null;
    const parts = url.pathname.split('/').filter(Boolean),
      [owner, repo] = parts;
    if (!owner || !repo || !/^[-\w.]+$/.test(owner) || !/^[-\w.]+$/.test(repo)) return null;
    if (parts.length === 2) return { kind: 'repo', owner, repo };
    if (parts[2] === 'issues' && parts[3] === 'new') return { kind: 'issue', owner, repo };
    if (parts[2] === 'pull' && /^[1-9]\d*$/.test(parts[3] ?? ''))
      return { kind: 'pr', owner, repo, number: Number(parts[3]) };
    return null;
  } catch {
    return null;
  }
}
export async function githubLineUrl(
  owner: string,
  repo: string,
  n: number,
  path: string,
  line: number,
  side: 'LEFT' | 'RIGHT',
) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(path)),
    hash = Array.from(new Uint8Array(bytes))
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('');
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pull/${n}/files#diff-${hash}${side === 'LEFT' ? 'L' : 'R'}${line}`;
}
