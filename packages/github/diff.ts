export type DiffLine = {
  type: 'add' | 'del' | 'ctx';
  oldLine?: number;
  newLine?: number;
  text: string;
};
export type Hunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: DiffLine[];
};
export function parsePatch(patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  let current: Hunk | undefined,
    oldLine = 0,
    newLine = 0;
  for (const line of patch.split(/\r?\n/)) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (match) {
      oldLine = Number(match[1]);
      newLine = Number(match[3]);
      current = {
        oldStart: oldLine,
        oldLines: Number(match[2] ?? 1),
        newStart: newLine,
        newLines: Number(match[4] ?? 1),
        header: line,
        lines: [],
      };
      hunks.push(current);
      continue;
    }
    if (!current || line.startsWith('\\') || line === '') continue;
    if (line[0] === '+')
      current.lines.push({ type: 'add', newLine: newLine++, text: line.slice(1) });
    else if (line[0] === '-')
      current.lines.push({ type: 'del', oldLine: oldLine++, text: line.slice(1) });
    else if (line[0] === ' ')
      current.lines.push({
        type: 'ctx',
        oldLine: oldLine++,
        newLine: newLine++,
        text: line.slice(1),
      });
  }
  return hunks;
}
export function isCommentable(hunks: Hunk[], line: number, side: 'LEFT' | 'RIGHT'): boolean {
  return (
    line > 0 &&
    hunks.some((h) =>
      h.lines.some((l) => (side === 'LEFT' ? l.oldLine === line : l.newLine === line)),
    )
  );
}
export function annotatePatch(patch: string): string {
  return parsePatch(patch)
    .map(
      (h) =>
        h.header +
        '\n' +
        h.lines
          .map((l) =>
            l.type === 'del'
              ? `L${l.oldLine} | -${l.text}`
              : l.type === 'add'
                ? `R${l.newLine} | +${l.text}`
                : `L${l.oldLine} R${l.newLine} |  ${l.text}`,
          )
          .join('\n'),
    )
    .join('\n');
}
