'use client';
import { useMemo } from 'react';
import { DiffView, DiffModeEnum, SplitSide } from '@git-diff-view/react';
import type { ReviewComment } from '@openself/shared/api';
import '@git-diff-view/react/styles/diff-view-pure.css';
export default function DiffCanvas({
  file,
  mode,
  comments,
  onSelect,
}: {
  file: { filename: string; previous_filename?: string; patch?: string };
  mode: 'split' | 'unified';
  comments: ReviewComment[];
  onSelect: (line: number, side: 'LEFT' | 'RIGHT') => void;
}) {
  const data = useMemo(
    () => ({
      oldFile: { fileName: file.previous_filename ?? file.filename },
      newFile: { fileName: file.filename },
      hunks: [
        `diff --git a/${file.previous_filename ?? file.filename} b/${file.filename}\n--- a/${file.previous_filename ?? file.filename}\n+++ b/${file.filename}\n${file.patch ?? ''}\n`,
      ],
    }),
    [file.filename, file.previous_filename, file.patch],
  );
  const extend = useMemo(() => {
    const oldFile: Record<string, { data: ReviewComment[] }> = {},
      newFile: Record<string, { data: ReviewComment[] }> = {};
    for (const c of comments.filter((c) => c.path === file.filename)) {
      const side = c.side === 'LEFT' ? oldFile : newFile;
      (side[c.line] ??= { data: [] }).data.push(c);
    }
    return { oldFile, newFile };
  }, [comments, file.filename]);
  return (
    <DiffView
      data={data}
      diffViewMode={mode === 'split' ? DiffModeEnum.Split : DiffModeEnum.Unified}
      diffViewTheme="light"
      diffViewFontSize={13}
      diffViewWrap
      diffViewAddWidget
      onAddWidgetClick={(line, side) => onSelect(line, side === SplitSide.old ? 'LEFT' : 'RIGHT')}
      extendData={extend}
      renderExtendLine={({ data }) => (
        <div className="inline-comment-view">
          {data.map((c, index) => (
            <p key={index}>{c.body}</p>
          ))}
        </div>
      )}
    />
  );
}
