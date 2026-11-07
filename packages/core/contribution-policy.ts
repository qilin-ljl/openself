import { AppError } from '@openself/shared/errors';

const secretPattern =
  /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/;
const supported =
  /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|kts|cs|c|cc|cpp|h|hpp|rb|php|swift|vue|svelte|sql|sh|bash|json|ya?ml|toml|md|mdx|css|scss|html)$/i;

export function assertContributionPath(path: string) {
  const lower = path.toLowerCase(),
    parts = lower.split('/');
  if (
    !path ||
    path.length > 400 ||
    /[\\:]/.test(path) ||
    [...path].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    parts.some((part) => !part || part === '.' || part === '..') ||
    parts.some((part) =>
      ['.git', '.ssh', '.aws', 'node_modules', 'vendor', 'dist', 'build', '.next'].includes(part),
    ) ||
    parts.some(
      (part) =>
        part === '.env' ||
        part.startsWith('.env.') ||
        ['.npmrc', '.pypirc', '.gitmodules', '.gitconfig', 'id_rsa', 'id_ed25519'].includes(part),
    ) ||
    lower.startsWith('.github/workflows/') ||
    /\.(?:pem|key|p12|pfx|crt)$/i.test(path)
  )
    throw new AppError('protected_path', 400);
}

export function sourceSkipReason(
  entry: { path: string; mode?: string; size?: number },
  body?: string,
): string | null {
  try {
    assertContributionPath(entry.path);
  } catch {
    return 'protected_path';
  }
  if (entry.mode && !['100644', '100755'].includes(entry.mode)) return 'non_regular_file';
  if ((entry.size ?? 0) > 200000) return 'too_large';
  if (
    /(?:^|\/)(?:[^/]*lock(?:\.json|\.ya?ml)?|[^/]*\.lock)$|\.min\.[jc]s$|\.map$|\.snap$/i.test(
      entry.path,
    )
  )
    return 'generated';
  if (
    !supported.test(entry.path) &&
    !/(?:^|\/)(?:Dockerfile|Makefile|CMakeLists\.txt)$/.test(entry.path)
  )
    return 'unsupported';
  if (body !== undefined && (body.includes('\0') || secretPattern.test(body)))
    return 'sensitive_content';
  return null;
}

export function applySourceEdits(
  before: string,
  edits: { original: string; replacement: string }[],
) {
  if (!edits.length || edits.length > 10 || before.length > 200000)
    throw new AppError('patch_invalid', 400);
  const crlf = before.includes('\r\n');
  let value = before.replaceAll('\r\n', '\n');
  for (const edit of edits) {
    const original = edit.original.replaceAll('\r\n', '\n');
    const replacement = edit.replacement.replaceAll('\r\n', '\n');
    const index = value.indexOf(original);
    if (!original || index < 0 || value.indexOf(original, index + 1) !== -1)
      throw new AppError('patch_context_mismatch', 409);
    value = value.slice(0, index) + replacement + value.slice(index + original.length);
  }
  if (value.length > 200000 || secretPattern.test(value)) throw new AppError('patch_invalid', 400);
  return crlf ? value.replaceAll('\n', '\r\n') : value;
}

export function matchesEvidence(body: string, line: number, evidence: string) {
  const lines = body.replaceAll('\r\n', '\n').split('\n');
  if (!Number.isInteger(line) || line < 1 || line > lines.length || evidence.trim().length < 5)
    return false;
  const normalize = (text: string) => text.trim().replace(/\s+/g, ' ');
  const quote = normalize(evidence);
  const first = normalize(lines[line - 1]!);
  return (
    !!first &&
    (first.includes(quote) ||
      (quote.startsWith(first) &&
        normalize(lines.slice(line - 1, line + 5).join('\n')).includes(quote)))
  );
}
