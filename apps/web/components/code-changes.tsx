'use client';
import diff from 'fast-diff';
import { useTranslations } from 'next-intl';
import type { PreparedChange } from '@openself/shared/contributions';
export function CodeChanges({ files }: { files: PreparedChange['files'] }) {
  const t = useTranslations('contribute');
  return (
    <div className="code-changes">
      {files.map((file) => (
        <details key={file.path} className="code-change-file" open>
          <summary>
            {file.path}
            <span>{file.action === 'create' ? t('newFile') : t('modifiedFile')}</span>
          </summary>
          <pre>
            {diff(file.before, file.after).map(([operation, text], index) => (
              <span
                key={index}
                className={
                  operation === 1 ? 'code-insert' : operation === -1 ? 'code-delete' : undefined
                }
              >
                {text}
              </span>
            ))}
          </pre>
        </details>
      ))}
    </div>
  );
}
