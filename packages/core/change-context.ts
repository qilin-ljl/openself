import { posix } from 'node:path';
import type { Entry } from './repository-source';
import { sourceSkipReason } from './contribution-policy';

export function selectChangeContext(entries: Entry[], target: Entry, description: string) {
  const directory = posix.dirname(target.path),
    stem = posix.basename(target.path).replace(/\.[^.]+$/, '');
  const mentions = [
    ...new Set(
      description.match(
        /[A-Za-z0-9_./-]+\.(?:json|[cm]?[jt]sx?|py|md|ya?ml|toml|cfg|ini|txt)\b/g,
      ) ?? [],
    ),
  ];
  const ancestors: string[] = [];
  let dir = directory;
  for (;;) {
    ancestors.push(dir);
    if (dir === '.') break;
    dir = posix.dirname(dir);
  }
  function score(entry: Entry) {
    if (entry.path === target.path) return 0;
    if (
      mentions.some(
        (path) =>
          entry.path === path || entry.path === posix.normalize(posix.join(directory, path)),
      )
    )
      return 1;
    const base = posix.basename(entry.path),
      parent = posix.dirname(entry.path),
      distance = ancestors.indexOf(parent);
    if (
      distance >= 0 &&
      /^(?:package\.json|pyproject\.toml|Cargo\.toml|go\.mod|requirements(?:-[\w-]+)?\.txt)$/.test(
        base,
      )
    )
      return 2 + distance;
    if (
      parent === directory &&
      /(?:config|rc)(?:\.[\w-]+)*\.(?:json|[cm]?[jt]s|ya?ml|toml)$/.test(base)
    )
      return 5;
    if (parent === directory && /^(?:README|CONTRIBUTING)\.md$/i.test(base)) return 6;
    if (mentions.some((path) => posix.basename(path) === base)) return 7;
    if (!/^readme$/i.test(stem) && entry.path.includes(stem)) return 8;
    if (entry.path === 'README.md') return 9;
    return 99;
  }
  return entries
    .filter((entry) => !sourceSkipReason(entry) && score(entry) < 99)
    .sort((a, b) => score(a) - score(b) || a.path.localeCompare(b.path))
    .slice(0, 8);
}
