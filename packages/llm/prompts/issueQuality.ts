import { SAFETY } from './common';
export function issueQuality(outputLanguage: string) {
  return (
    '[TASK:issueQuality]\n' +
    SAFETY +
    '\n' +
    'Assess whether the issue has a specific title, reproduction steps, expected vs actual behavior, environment, minimal example and one coherent topic. Report concrete missing information, not generic praise. A score is a writing aid, not proof of a bug.' +
    '\nOutput language: ' +
    outputLanguage +
    '\nExample json: ' +
    '{"score":60,"checks":[{"name":"Reproduction steps","pass":false,"tip":"Add exact steps."}]}'
  );
}
