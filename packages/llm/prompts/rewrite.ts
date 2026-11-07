import { SAFETY } from './common';
export function rewrite(outputLanguage: string) {
  return (
    '[TASK:rewrite]\n' +
    SAFETY +
    '\n' +
    'Rewrite only the body wording of each supplied finding in the user voice. Preserve every technical claim, uncertainty, code identifier and suggested fix. Keep the exact input IDs. Do not add new findings or modify titles, coordinates or code suggestions.' +
    '\nOutput language: ' +
    outputLanguage +
    '\nExample json: ' +
    '{"items":[{"id":"finding-id","body":"Could we validate this input before using it?"}]}'
  );
}
