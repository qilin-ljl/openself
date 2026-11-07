import { z } from 'zod';
export const PlaybookId = z.enum(['security', 'performance', 'readability', 'tests']);
export const RiskMap = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      score: z.number().int().min(1).max(5),
      reasons: z.array(z.string()).max(3),
    }),
  ),
});
export const Finding = z.object({
  path: z.string().max(500),
  line: z.number().int().positive(),
  side: z.enum(['LEFT', 'RIGHT']),
  startLine: z.number().int().positive().optional(),
  severity: z.enum(['blocker', 'major', 'minor', 'nit']),
  category: z.enum([
    'bug',
    'security',
    'performance',
    'readability',
    'test',
    'convention',
    'other',
  ]),
  title: z.string().max(120),
  body: z.string().max(2000),
  suggestion: z.string().max(10000).optional(),
  confidence: z.number().min(0).max(1),
});
export const FindingList = z.object({ findings: z.array(Finding).max(20) });
export const RuleCard = z.object({
  summary: z.string(),
  naming: z.array(z.string()),
  commitConvention: z.string().nullable(),
  testing: z.array(z.string()),
  topConcerns: z.array(z.object({ topic: z.string(), example: z.string() })).max(10),
  doNot: z.array(z.string()),
});
export const StyleProfile = z.object({
  focusOrder: z.array(z.string()),
  tone: z.enum(['direct', 'gentle', 'neutral']),
  usesQuestions: z.boolean(),
  givesCodeSuggestions: z.boolean(),
  language: z.enum(['zh', 'en', 'mixed']),
  phrases: z.array(z.string()).max(10),
  notes: z.string(),
});
export const StyleProfileResult = StyleProfile.extend({ profileMd: z.string() });
export const DEFAULT_STYLE_PROFILE: z.infer<typeof StyleProfile> = {
  focusOrder: ['bug', 'tests', 'readability'],
  tone: 'neutral',
  usesQuestions: true,
  givesCodeSuggestions: true,
  language: 'en',
  phrases: [],
  notes: '',
};
export const IssueDraft = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(60000),
  fields: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
  missingInfo: z.array(z.object({ field: z.string(), question: z.string() })),
  labels: z.array(z.string()).optional(),
});
export const IssueQuality = z.object({
  score: z.number().int().min(0).max(100),
  checks: z.array(z.object({ name: z.string(), pass: z.boolean(), tip: z.string() })),
});
export const DuplicateJudgement = z.object({
  candidates: z.array(
    z.object({
      number: z.number().int().positive(),
      verdict: z.enum(['duplicate', 'related', 'unrelated']),
      reason: z.string(),
    }),
  ),
});
export const RewriteList = z.object({
  items: z.array(z.object({ id: z.string(), body: z.string().max(2000) })),
});
export const Keywords = z.object({ keywords: z.array(z.string().max(60)).min(1).max(6) });
export const Translation = z.object({ text: z.string().max(60000) });
export type Finding = z.infer<typeof Finding>;
export type RiskMap = z.infer<typeof RiskMap>;
export type IssueDraft = z.infer<typeof IssueDraft>;
export type IssueQuality = z.infer<typeof IssueQuality>;
export type StyleProfile = z.infer<typeof StyleProfile>;
export type RuleCard = z.infer<typeof RuleCard>;
export const StartReview = z.object({
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  prNumber: z.number().int().positive(),
  playbooks: z
    .array(PlaybookId)
    .min(1)
    .max(4)
    .default(['security', 'performance', 'readability', 'tests']),
  lang: z.enum(['zh', 'en']).optional(),
});
export const IssueAIInput = z.object({
  mode: z.enum(['fast', 'deep']).default('fast'),
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  text: z.string().trim().min(1).max(20000),
  templateId: z.string().optional(),
  answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
  lang: z.enum(['zh', 'en']).optional(),
});
export type FindingDTO = Finding & {
  id: string;
  status: 'pending' | 'accepted' | 'edited' | 'rejected';
};
export type ReviewDTO = {
  id: string;
  status: 'queued' | 'scoring' | 'reviewing' | 'done' | 'failed';
  progress: number;
  headSha: string;
  error: string | null;
  riskMapJson:
    | (RiskMap & {
        skipped: { path: string; reason: string }[];
        reviewedFiles: number;
        rulecardAvailable: boolean;
      })
    | null;
  findings: FindingDTO[];
};
export type JobDTO = {
  id: string;
  kind: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  resultJson: unknown;
  error: string | null;
  input?: unknown;
  createdAt?: string;
  updatedAt?: string;
  attempts?: number;
};
export type JobProgress = {
  stage: string;
  completed?: number;
  total?: number;
  current?: string;
  cached?: number;
};
export type JobListItem = Omit<JobDTO, 'input' | 'resultJson'> & {
  repo: string | null;
  href: string;
  progress?: JobProgress;
  durationMs?: number;
  incomplete?: boolean;
};
