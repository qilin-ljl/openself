import { SAFETY } from './common';
export function dedupe(outputLanguage: string) {
  return (
    '[TASK:dedupe]\n' +
    SAFETY +
    '\n' +
    'Compare the proposed issue to candidate issues. A shared keyword is not sufficient for duplicate: compare symptoms, trigger and expected behavior. Return only candidate issue numbers; mark uncertainty as related rather than inventing certainty.' +
    '\nOutput language: ' +
    outputLanguage +
    '\nExample json: ' +
    '{"candidates":[{"number":12,"verdict":"related","reason":"Shares a component, but the reproduction differs."}]}'
  );
}
