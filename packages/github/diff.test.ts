import { describe, expect, it } from 'vitest';
import { parsePatch, isCommentable, annotatePatch } from './diff';
const patch =
  '@@ -2,3 +2,4 @@\n context\n-removed\n+added\n+extra\n end\n@@ -20 +21 @@\n-old\n+new\n\\ No newline at end of file';
describe('unified diff coordinates', () => {
  it('maps both sides and multiple hunks without counting the no-newline marker', () => {
    const hunks = parsePatch(patch);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]?.lines).toEqual([
      { type: 'ctx', oldLine: 2, newLine: 2, text: 'context' },
      { type: 'del', oldLine: 3, text: 'removed' },
      { type: 'add', newLine: 3, text: 'added' },
      { type: 'add', newLine: 4, text: 'extra' },
      { type: 'ctx', oldLine: 4, newLine: 5, text: 'end' },
    ]);
    expect(hunks[1]?.lines).toHaveLength(2);
  });
  it('allows only actual changed/context coordinates on the requested side', () => {
    const h = parsePatch(patch);
    expect(isCommentable(h, 4, 'RIGHT')).toBe(true);
    expect(isCommentable(h, 5, 'LEFT')).toBe(false);
    expect(isCommentable(h, 2, 'LEFT')).toBe(true);
    expect(isCommentable(h, 10, 'RIGHT')).toBe(false);
  });
  it('handles a new file, a deletion and a rename without a patch', () => {
    expect(parsePatch('@@ -0,0 +1,2 @@\n+one\n+two')[0]?.lines.map((l) => l.newLine)).toEqual([
      1, 2,
    ]);
    expect(isCommentable(parsePatch('@@ -1,2 +0,0 @@\n-one\n-two'), 2, 'LEFT')).toBe(true);
    expect(parsePatch('')).toEqual([]);
  });
  it('annotates model input with trustworthy side-specific line numbers', () => {
    expect(annotatePatch('@@ -1 +1 @@\n-old\n+new')).toContain('L1 | -old');
    expect(annotatePatch('@@ -1 +1 @@\n-old\n+new')).toContain('R1 | +new');
  });
});
