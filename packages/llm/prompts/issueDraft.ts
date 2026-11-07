import { SAFETY } from './common';
export function issueDraft(outputLanguage: string) {
  return (
    '[TASK:issueDraft]\n' +
    SAFETY +
    '\n' +
    'Draft an issue using ONLY the user description, chosen template and supplied context. Distinguish a bug report from a feature, simplification, documentation or usability proposal. For proposals explain the scenario, suggested change, benefit and tradeoffs; do not invent a bug or claim an existing feature is absent. Never invent versions, environment details or reproduction steps. Put only essential missing information in missingInfo; do not demand reproduction/version details for a general proposal unless the chosen template requires them. For Issue Forms, populate fields by their exact field IDs using strings or arrays for checkbox/dropdown answers. Include markdown body. Do not publish.' +
    '\nOutput language: ' +
    outputLanguage +
    '\nExample json: ' +
    '{"title":"Describe the reproducible problem","body":"## Actual behavior\\\\nThe supplied behavior.","fields":{},"missingInfo":[{"field":"version","question":"Which version did you use?"}],"labels":[]}'
  );
}
