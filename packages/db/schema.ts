import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  bigint,
  boolean,
  integer,
  real,
  timestamp,
  date,
  jsonb,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
const id = () => uuid('id').defaultRandom().primaryKey();
const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date());
export const users = pgTable(
  'users',
  {
    id: id(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    githubId: bigint('github_id', { mode: 'number' }).unique().notNull(),
    login: text('login').notNull(),
    name: text('name'),
    avatarUrl: text('avatar_url'),
    locale: text('locale', { enum: ['zh', 'en'] })
      .default('zh')
      .notNull(),
    aiDisclosure: boolean('ai_disclosure').default(true).notNull(),
    privateRepoEnabled: boolean('private_repo_enabled').default(false).notNull(),
    privateAiConsentAt: timestamp('private_ai_consent_at', { withTimezone: true }),
    learningMode: boolean('learning_mode').default(false).notNull(),
    maxFindings: integer('max_findings').default(10).notNull(),
  },
  (table) => [
    check('user_locale', sql`${table.locale} in ('zh', 'en')`),
    check('max_findings', sql`${table.maxFindings} in (10, 20)`),
  ],
);
const userId = () =>
  uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull();
export const aiJobs = pgTable(
  'ai_jobs',
  {
    id: id(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    userId: userId(),
    kind: text('kind').notNull(),
    status: text('status', { enum: ['queued', 'running', 'done', 'failed'] })
      .default('queued')
      .notNull(),
    payloadJson: jsonb('payload_json').notNull(),
    resultJson: jsonb('result_json'),
    error: text('error'),
    attempts: integer('attempts').default(0).notNull(),
  },
  (t) => [
    index('ai_jobs_user_status_idx').on(t.userId, t.status),
    index('ai_jobs_status_updated_idx').on(t.status, t.updatedAt),
  ],
);
export const oauthTokens = pgTable('oauth_tokens', {
  id: id(),
  createdAt: createdAt(),
  userId: userId().unique(),
  accessTokenEnc: text('access_token_enc').notNull(),
  scopes: text('scopes').notNull(),
  updatedAt: updatedAt(),
});
export const userApiKeys = pgTable('user_api_keys', {
  id: id(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  userId: userId().unique(),
  provider: text('provider').default('deepseek').notNull(),
  keyEnc: text('key_enc').notNull(),
  last4: text('last4').notNull(),
});
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    createdAt: createdAt(),
    userId: userId(),
    kind: text('kind', { enum: ['web', 'extension'] }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('sessions_user_idx').on(table.userId),
    index('sessions_expiry_idx').on(table.expiresAt),
    check('session_kind', sql`${table.kind} in ('web','extension')`),
  ],
);
export const extensionAuthCodes = pgTable('extension_auth_codes', {
  code: text('code').primaryKey(),
  createdAt: createdAt(),
  userId: userId(),
  redirectUri: text('redirect_uri').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
});
export const styleProfiles = pgTable('style_profiles', {
  id: id(),
  createdAt: createdAt(),
  userId: userId().unique(),
  profileJson: jsonb('profile_json').notNull(),
  profileMd: text('profile_md').notNull(),
  sourceCount: integer('source_count').notNull(),
  pendingEditCount: integer('pending_edit_count').default(0).notNull(),
  updatedAt: updatedAt(),
});
export const repoRulecards = pgTable('repo_rulecards', {
  id: id(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  repoFullName: text('repo_full_name').unique().notNull(),
  rulecardJson: jsonb('rulecard_json').notNull(),
  sourceSha: text('source_sha').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
export const drafts = pgTable(
  'drafts',
  {
    id: id(),
    createdAt: createdAt(),
    userId: userId(),
    kind: text('kind', { enum: ['issue', 'review', 'pull_request'] }).notNull(),
    repoFullName: text('repo_full_name').notNull(),
    targetNumber: integer('target_number'),
    status: text('status', {
      enum: ['draft', 'approved', 'publishing', 'published', 'failed', 'discarded'],
    })
      .default('draft')
      .notNull(),
    payloadJson: jsonb('payload_json').notNull(),
    idempotencyKey: text('idempotency_key').unique().notNull(),
    githubUrl: text('github_url'),
    error: text('error'),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('drafts_user_status_idx').on(table.userId, table.status),
    check('draft_kind', sql`${table.kind} in ('issue','review','pull_request')`),
    check(
      'draft_status',
      sql`${table.status} in ('draft','approved','publishing','published','failed','discarded')`,
    ),
  ],
);
export const reviewSessions = pgTable(
  'review_sessions',
  {
    id: id(),
    createdAt: createdAt(),
    userId: userId(),
    repoFullName: text('repo_full_name').notNull(),
    prNumber: integer('pr_number').notNull(),
    headSha: text('head_sha').notNull(),
    playbooks: text('playbooks').array().notNull(),
    status: text('status', { enum: ['queued', 'scoring', 'reviewing', 'done', 'failed'] })
      .default('queued')
      .notNull(),
    riskMapJson: jsonb('risk_map_json'),
    progress: integer('progress').default(0).notNull(),
    error: text('error'),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('review_session_head_idx').on(
      table.userId,
      table.repoFullName,
      table.prNumber,
      table.headSha,
    ),
    check('review_progress', sql`${table.progress} between 0 and 100`),
  ],
);
export const reviewFindings = pgTable(
  'review_findings',
  {
    id: id(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    sessionId: uuid('session_id')
      .references(() => reviewSessions.id, { onDelete: 'cascade' })
      .notNull(),
    path: text('path').notNull(),
    line: integer('line').notNull(),
    side: text('side', { enum: ['LEFT', 'RIGHT'] }).notNull(),
    startLine: integer('start_line'),
    severity: text('severity', { enum: ['blocker', 'major', 'minor', 'nit'] }).notNull(),
    category: text('category').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    suggestion: text('suggestion'),
    confidence: real('confidence').notNull(),
    status: text('status', { enum: ['pending', 'accepted', 'edited', 'rejected'] })
      .default('pending')
      .notNull(),
  },
  (table) => [
    index('findings_session_idx').on(table.sessionId),
    check('finding_confidence', sql`${table.confidence} between 0 and 1`),
    check('finding_line', sql`${table.line} > 0`),
  ],
);
export const draftEdits = pgTable('draft_edits', {
  id: id(),
  createdAt: createdAt(),
  userId: userId(),
  source: text('source', { enum: ['finding', 'issue'] }).notNull(),
  before: text('before').notNull(),
  after: text('after').notNull(),
});
export const issueChecks = pgTable('issue_checks', {
  id: id(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  userId: userId(),
  repoFullName: text('repo_full_name').notNull(),
  inputText: text('input_text').notNull(),
  duplicatesJson: jsonb('duplicates_json').notNull(),
  qualityJson: jsonb('quality_json'),
});
export const radarItems = pgTable(
  'radar_items',
  {
    id: id(),
    createdAt: createdAt(),
    userId: userId(),
    date: date('date').notNull(),
    itemsJson: jsonb('items_json').notNull(),
  },
  (table) => [uniqueIndex('radar_user_date_idx').on(table.userId, table.date)],
);
export const usageCounters = pgTable(
  'usage_counters',
  {
    id: id(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    userId: userId(),
    date: date('date').notNull(),
    kind: text('kind').notNull(),
    count: integer('count').default(0).notNull(),
    tokensIn: integer('tokens_in').default(0).notNull(),
    tokensOut: integer('tokens_out').default(0).notNull(),
  },
  (table) => [uniqueIndex('usage_user_date_kind_idx').on(table.userId, table.date, table.kind)],
);
export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    createdAt: createdAt(),
    userId: userId(),
    action: text('action', {
      enum: ['issue.create', 'review.submit', 'pull_request.create'],
    }).notNull(),
    repoFullName: text('repo_full_name').notNull(),
    target: text('target').notNull(),
    githubUrl: text('github_url').notNull(),
    payloadHash: text('payload_hash').notNull(),
  },
  (table) => [index('audit_user_date_idx').on(table.userId, table.createdAt.desc())],
);
