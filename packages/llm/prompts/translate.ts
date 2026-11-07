import { SAFETY } from './common';
export function translate(outputLanguage: string) {
  return (
    '[TASK:translate]\n' +
    SAFETY +
    '\n' +
    'Translate the supplied text faithfully into the output language. Preserve Markdown, links, code blocks, identifiers, versions, numbers and uncertainty. Do not add claims.' +
    '\nOutput language: ' +
    outputLanguage +
    '\nExample json: ' +
    '{"text":"Translated text"}'
  );
}
