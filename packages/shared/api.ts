import { z } from 'zod';
export const GitHubProfile = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1),
  name: z.string().nullable(),
  avatar_url: z.url(),
});
export const ApiError = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
export const Viewer = z.object({
  id: z.string().uuid(),
  login: z.string(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  locale: z.enum(['zh', 'en']),
  aiDisclosure: z.boolean(),
  privateRepoEnabled: z.boolean(),
  privateAiConsent: z.boolean().default(false),
  learningMode: z.boolean().default(false),
  maxFindings: z.union([z.literal(10), z.literal(20)]).default(10),
});
export const RepositoryName = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
  .max(200)
  .transform((value) => value.toLowerCase());
export const PageNumber = z.coerce.number().int().min(1).max(50).default(1);
export type OwnedRepositoryDTO = {
  id: number;
  fullName: string;
  description: string | null;
  language: string | null;
  private: boolean;
  archived: boolean;
  updatedAt: string | null;
};
export const IssuePayload = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(60000),
  labels: z.array(z.string().max(100)).max(20).optional(),
  templateId: z.string().max(200).optional(),
  answers: z
    .record(z.string(), z.union([z.string().max(30000), z.array(z.string().max(1000)).max(100)]))
    .optional(),
  lang: z.enum(['zh', 'en']),
  aiGenerated: z.boolean().default(false),
});
export const ReviewComment = z
  .object({
    findingId: z.uuid().optional(),
    path: z.string().min(1).max(500),
    line: z.number().int().positive().max(10000000),
    side: z.enum(['LEFT', 'RIGHT']),
    startLine: z.number().int().positive().optional(),
    body: z.string().trim().min(1).max(10000),
  })
  .refine((c) => !c.startLine || c.startLine <= c.line);
export const ReviewPayload = z
  .object({
    reviewSessionId: z.uuid().optional(),
    headSha: z.string().regex(/^[a-f0-9]{40,64}$/),
    title: z.string().max(200).default(''),
    event: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']),
    body: z.string().max(60000),
    comments: z.array(ReviewComment).max(100),
    lang: z.enum(['zh', 'en']).default('en'),
    aiGenerated: z.boolean().default(false),
  })
  .refine((p) => p.event === 'APPROVE' || p.body.trim().length > 0 || p.comments.length > 0);
export type ReviewPayload = z.infer<typeof ReviewPayload>;
export type ReviewComment = z.infer<typeof ReviewComment>;
export const CreateDraft = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('issue'), repo: RepositoryName, payload: IssuePayload }),
  z.object({
    kind: z.literal('review'),
    repo: RepositoryName,
    prNumber: z.number().int().positive(),
    payload: ReviewPayload,
  }),
]);
export const DraftStatus = z.enum([
  'draft',
  'approved',
  'publishing',
  'published',
  'failed',
  'discarded',
]);
export const UpdatePreferences = z
  .object({
    locale: z.enum(['zh', 'en']).optional(),
    aiDisclosure: z.boolean().optional(),
    learningMode: z.boolean().optional(),
    maxFindings: z.union([z.literal(10), z.literal(20)]).optional(),
    privateRepoEnabled: z.boolean().optional(),
    privateAiConsent: z.boolean().optional(),
  })
  .strict();
const DraftBase = z.object({
  id: z.string().uuid(),
  repoFullName: z.string(),
  targetNumber: z.number().nullable(),
  status: DraftStatus,
  githubUrl: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const DraftDTO = z.discriminatedUnion('kind', [
  DraftBase.extend({ kind: z.literal('issue'), payloadJson: IssuePayload }),
  DraftBase.extend({ kind: z.literal('review'), payloadJson: ReviewPayload }),
]);
export type IssuePayload = z.infer<typeof IssuePayload>;
export type DraftDTO = z.infer<typeof DraftDTO>;
export { z };
