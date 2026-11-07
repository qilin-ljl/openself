import { SAFETY } from './common';
export function keywords(outputLanguage: string) {
  return (
    '[TASK:keywords]\n' +
    SAFETY +
    '\n' +
    'Extract at most six short, concrete search terms describing the component, symptom and trigger. Do not return GitHub search qualifiers.' +
    '\nOutput language: ' +
    outputLanguage +
    '\nExample json: ' +
    '{"keywords":["empty input","validation"]}'
  );
}
