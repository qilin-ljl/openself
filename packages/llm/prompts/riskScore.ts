import { SAFETY } from './common';
export function riskScore(outputLanguage: string) {
  return (
    '[TASK:riskScore]\n' +
    SAFETY +
    '\n' +
    'Score each supplied file from 1 to 5. Prioritize auth, payment, crypto, concurrency, migrations, configuration and CI. Raise risk when meaningful behavioral changes have no tests. Documentation, lockfiles and generated code are low risk. Return only supplied paths; do not infer unseen file contents.' +
    '\nOutput language: ' +
    outputLanguage +
    '\nExample json: ' +
    '{"files":[{"path":"src/auth.ts","score":4,"reasons":["Unvalidated boundary input"]}]}'
  );
}
