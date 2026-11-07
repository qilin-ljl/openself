import { z } from 'zod';
const repo = z
  .string()
  .regex(/^[\w.-]+\/[\w.-]+$/)
  .max(200)
  .transform((value) => value.toLowerCase());
const sha = z.string().regex(/^[a-f0-9]{40,64}$/);
export const IdeaInput = z.object({ idea: z.string().trim().min(3).max(5000) });
export const IdeaQueries = z.object({
  queries: z.array(z.string().trim().min(1).max(160)).min(1).max(3),
});
export const RankedProjects = z.object({
  projects: z
    .array(
      z.object({
        repo,
        reason: z.string().max(2000),
        directions: z.array(z.string().max(1000)).max(3),
      }),
    )
    .max(6),
});
export const DiscoveryResult = z.object({
  idea: z.string(),
  queries: z.array(z.string()),
  examined: z.number(),
  projects: z.array(
    z.object({
      repo,
      url: z.url(),
      description: z.string().nullable(),
      language: z.string().nullable(),
      stars: z.number(),
      updatedAt: z.string().nullable(),
      reason: z.string(),
      directions: z.array(z.string()),
    }),
  ),
});
export const RepositoryScanInput = z.object({
  repo,
  goal: z.string().trim().max(4000).default(''),
  maxFiles: z.number().int().min(1).max(100).default(20),
  mode: z.enum(['fast', 'deep']).default('fast'),
  focus: z.enum(['both', 'bugs', 'opportunities']).default('both'),
  planJobId: z.uuid().optional(),
  selectedPaths: z.array(z.string().min(1).max(400)).max(100).optional(),
});
export const RepositoryPlan = z.object({
  repo,
  repoId: z.number().int().positive(),
  baseBranch: z.string(),
  baseSha: sha,
  goal: z.string(),
  summary: z.string(),
  treeTruncated: z.boolean(),
  modules: z.array(z.object({ name: z.string(), purpose: z.string(), paths: z.array(z.string()) })),
  files: z.array(
    z.object({
      path: z.string(),
      reason: z.string(),
      role: z.string(),
      focusLines: z.array(z.number().int().positive()).default([]),
    }),
  ),
  documents: z.array(z.string()).default([]),
});
export type RepositoryPlan = z.infer<typeof RepositoryPlan>;
export const ScanFindingInput = z.object({
  path: z.string().min(1).max(400),
  line: z.number().int().positive(),
  kind: z.enum(['bug', 'improvement', 'tests', 'docs']),
  title: z.string().min(1).max(200),
  explanation: z.string().max(3000),
  evidence: z.string().min(5).max(2000),
  suggestion: z.string().max(3000),
  verification: z.array(z.string().max(1000)).max(5),
  confidence: z.number().min(0).max(1),
  relatedIssues: z.array(z.number().int().positive()).max(5).default([]),
  audience: z.string().max(2000).default(''),
  benefit: z.string().max(2000).default(''),
  tradeoffs: z.string().max(2000).default(''),
  discussionOnly: z.boolean().default(false),
});
export const ScanBatch = z.object({ findings: z.array(ScanFindingInput).max(12) });
export const ScanFinding = ScanFindingInput.extend({ id: z.uuid(), sourceUrl: z.url() });
export const RepositoryScanResult = z.object({
  repo,
  repoId: z.number().int().positive(),
  baseBranch: z.string(),
  baseSha: sha,
  goal: z.string(),
  treeTruncated: z.boolean(),
  eligibleFiles: z.number(),
  examinedFiles: z.number(),
  examinedCharacters: z.number(),
  analysisFailedFiles: z.number().int().nonnegative().default(0),
  skippedCount: z.number(),
  scanned: z.array(
    z.object({ path: z.string(), lines: z.number(), totalLines: z.number(), partial: z.boolean() }),
  ),
  skipped: z.array(z.object({ path: z.string(), reason: z.string() })),
  findings: z.array(ScanFinding),
  invalidFindings: z.number(),
  relatedIssues: z.array(z.object({ number: z.number(), title: z.string(), url: z.url() })),
  mode: z.enum(['fast', 'deep']).default('fast'),
  focus: z.enum(['both', 'bugs', 'opportunities']).default('both'),
  reusedBatches: z.number().default(0),
  plan: RepositoryPlan.optional(),
  ranges: z.array(z.object({ path: z.string(), start: z.number(), end: z.number() })).default([]),
});
export const PrepareChangeInput = z.object({
  scanJobId: z.uuid(),
  findingId: z.uuid(),
  instruction: z.string().max(3000).default(''),
});
export const ModelCodeEdits = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(20000),
  verification: z.array(z.string().max(1000)).max(8),
  changes: z
    .array(
      z.object({
        path: z.string().min(1).max(400),
        action: z.enum(['edit', 'create']),
        edits: z
          .array(z.object({ original: z.string().max(20000), replacement: z.string().max(30000) }))
          .max(10)
          .default([]),
        content: z.string().max(40000).optional(),
      }),
    )
    .max(5),
});
export const PreparedFile = z.object({
  path: z.string(),
  action: z.enum(['edit', 'create']),
  before: z.string().max(200000),
  after: z.string().max(200000),
  blobSha: sha.nullable(),
  mode: z.enum(['100644', '100755']),
});
export const PreparedChange = z.object({
  repo,
  repoId: z.number().int().positive(),
  baseBranch: z.string(),
  baseSha: sha,
  scanJobId: z.uuid(),
  findingId: z.uuid(),
  title: z.string().min(1).max(200),
  body: z.string().max(60000),
  verification: z.array(z.string()),
  testsExecuted: z.literal(false),
  files: z.array(PreparedFile).min(1).max(5),
});
export const PullRequestDraftInput = z.object({
  changeJobId: z.uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(60000).optional(),
  asDraft: z.boolean().default(true),
});
export const PullRequestPayload = PreparedChange.extend({
  changeJobId: z.uuid(),
  aiGenerated: z.literal(true),
  lang: z.enum(['zh', 'en']),
  asDraft: z.boolean(),
});
export type RepositoryScanResult = z.infer<typeof RepositoryScanResult>;
export type ScanFinding = z.infer<typeof ScanFinding>;
export type PreparedChange = z.infer<typeof PreparedChange>;
export type PullRequestPayload = z.infer<typeof PullRequestPayload>;
export type DiscoveryResult = z.infer<typeof DiscoveryResult>;
