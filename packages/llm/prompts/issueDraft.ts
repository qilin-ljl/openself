import { SAFETY } from './common';
export function issueDraft(outputLanguage: string) {
  return (
    '[TASK:issueDraft]\n' +
    SAFETY +
    '\n' +
    'Draft an issue using ONLY the user description, chosen template and supplied context. Never invent versions, environment details or reproduction steps. Put missing essential information in missingInfo. For Issue Forms, populate fields by their exact field IDs using strings or arrays for checkbox/dropdown answers. Include markdown body. Do not publish.' +
    '\nOutput language: ' +
    outputLanguage +
    '\nExample json: ' +
    '{"title":"Describe the reproducible problem","body":"## Actual behavior\\\\nThe supplied behavior.","fields":{},"missingInfo":[{"field":"version","question":"Which version did you use?"}],"labels":[]}'
  );
}
