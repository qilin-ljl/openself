import { SAFETY } from './common';
export function styleProfile(outputLanguage: string) {
  return (
    '[TASK:styleProfile]\n' +
    SAFETY +
    '\n' +
    'Describe the user review voice using only their supplied past comments and edits. Distinguish technical priorities from politeness and wording. Do not infer sensitive traits. Return a concise profileMd in the output language. When there is no evidence, use the neutral default rather than inventing preferences.' +
    '\nOutput language: ' +
    outputLanguage +
    '\nExample json: ' +
    '{"focusOrder":["bug","tests"],"tone":"neutral","usesQuestions":true,"givesCodeSuggestions":true,"language":"en","phrases":[],"notes":"","profileMd":"A neutral review voice focused on correctness."}'
  );
}
