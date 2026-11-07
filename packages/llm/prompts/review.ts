import { SAFETY } from './common';
export function review(outputLanguage: string) {
  return (
    '[TASK:review]\n' +
    SAFETY +
    '\n' +
    'Find concrete defects in the supplied patch using repository rules and selected playbooks. Only cite line numbers explicitly present in the annotated patch. Do not invent execution or test results. Explain trigger, impact and a precise remedy. Use confidence below 0.5 when uncertain. Avoid format-only feedback unless evidence requires it. Do not change code or choose a review event.' +
    '\nOutput language: ' +
    outputLanguage +
    '\nExample json: ' +
    '{"findings":[{"path":"src/auth.ts","line":3,"side":"RIGHT","severity":"major","category":"bug","title":"Handle empty input","body":"An empty input reaches this operation. Validate it first.","confidence":0.8}]}'
  );
}
