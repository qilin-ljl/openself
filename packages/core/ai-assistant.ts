import { eq, desc, schema, sql } from '@openself/db';
import {
  IssueAIInput,
  IssueDraft,
  IssueQuality,
  DuplicateJudgement,
  Keywords,
  Translation,
  StyleProfileResult,
  DEFAULT_STYLE_PROFILE,
} from '@openself/shared/ai';
import { z } from '@openself/shared/api';
import { AppError } from '@openself/shared/errors';
import * as prompts from '@openself/llm/prompts';
import type { RunContext } from './ai-context';
import { repositoryLanguage } from './review-analysis';
export async function runAssistantTask(ctx: RunContext, kind: string, input: unknown) {
  if (kind === 'style.build') {
    const gh = await ctx.workspace.githubFor(ctx.user.id),
      comments = await gh.getUserReviewComments(
        ctx.user.login,
        ctx.user.privateRepoEnabled && !!ctx.user.privateAiConsentAt,
      );
    const edits = await ctx.db
      .select()
      .from(schema.draftEdits)
      .where(eq(schema.draftEdits.userId, ctx.user.id))
      .orderBy(desc(schema.draftEdits.createdAt))
      .limit(50);
    const [old] = await ctx.db
      .select()
      .from(schema.styleProfiles)
      .where(eq(schema.styleProfiles.userId, ctx.user.id));
    const consumed = old?.pendingEditCount ?? 0;
    const result =
      comments.length || edits.length
        ? (
            await ctx.provider.completeJSON({
              tier: 'deep',
              system: prompts.styleProfile(ctx.lang),
              user: prompts.untrusted({
                comments: comments.slice(0, 200).map((s) => s.slice(0, 2000)),
                edits,
              }),
              schema: StyleProfileResult,
            })
          ).data
        : {
            ...DEFAULT_STYLE_PROFILE,
            profileMd:
              ctx.lang === 'zh'
                ? '暂无历史样本，采用中性、关注正确性与测试的默认风格。'
                : 'No history yet. Using a neutral style focused on correctness and tests.',
          };
    await ctx.db
      .insert(schema.styleProfiles)
      .values({
        userId: ctx.user.id,
        profileJson: result,
        profileMd: result.profileMd,
        sourceCount: comments.length + edits.length,
        pendingEditCount: 0,
      })
      .onConflictDoUpdate({
        target: schema.styleProfiles.userId,
        set: {
          profileJson: result,
          profileMd: result.profileMd,
          sourceCount: comments.length + edits.length,
          pendingEditCount: sql`greatest(0,${schema.styleProfiles.pendingEditCount}-${consumed})`,
        },
      });
    return result;
  }
  if (kind === 'translate') {
    const parsed = z.object({ text: z.string().max(60000), to: z.enum(['zh', 'en']) }).parse(input);
    return (
      await ctx.provider.completeJSON({
        tier: 'fast',
        system: prompts.translate(parsed.to),
        user: prompts.untrusted(parsed.text),
        schema: Translation,
      })
    ).data;
  }
  const parsed =
    kind === 'issue.quality'
      ? z
          .object({
            repo: z.string(),
            title: z.string().max(200),
            body: z.string().max(60000),
            templateId: z.string().optional(),
          })
          .parse(input)
      : IssueAIInput.parse(input);
  const [owner, repo] = parsed.repo.toLowerCase().split('/') as [string, string],
    gh = await ctx.workspace.githubFor(ctx.user.id),
    info = await ctx.workspace.assertRepo(ctx.user, owner, repo);
  if (info.private && !ctx.user.privateAiConsentAt)
    throw new AppError('private_ai_consent_required', 403);
  await ctx.onProgress?.({ progress: { stage: 'context' } });
  const readme = await gh.getReadme(owner, repo),
    lang = 'lang' in parsed && parsed.lang ? parsed.lang : repositoryLanguage(readme.body);
  if (kind === 'issue.check') {
    const text = 'text' in parsed ? parsed.text : '';
    const keywords = (
      await ctx.provider.completeJSON({
        tier: 'fast',
        system: prompts.keywords(lang),
        user: prompts.untrusted(text),
        schema: Keywords,
      })
    ).data.keywords;
    const candidates = new Map<
      number,
      { number: number; title: string; body: string; url: string }
    >();
    for (const term of keywords.slice(0, 3)) {
      const clean = term.replace(/[^\p{L}\p{N}_. -]/gu, ' ').trim();
      if (!clean) continue;
      const response = await gh.searchIssues(`repo:${owner}/${repo} is:issue ${clean}`);
      for (const issue of response.items)
        candidates.set(issue.number, {
          number: issue.number,
          title: issue.title,
          body: (issue.body ?? '').slice(0, 600),
          url: issue.html_url,
        });
      if (candidates.size >= 20) break;
    }
    const shortlist = [...candidates.values()].slice(0, 20);
    const judged = shortlist.length
      ? (
          await ctx.provider.completeJSON({
            tier: 'fast',
            system: prompts.dedupe(lang),
            user: prompts.untrusted({ text, candidates: shortlist }),
            schema: DuplicateJudgement,
          })
        ).data.candidates
      : [];
    const result = judged
      .filter((j) => shortlist.some((s) => s.number === j.number))
      .map((j) => ({ ...shortlist.find((s) => s.number === j.number)!, ...j }));
    const [check] = await ctx.db
      .insert(schema.issueChecks)
      .values({
        userId: ctx.user.id,
        repoFullName: parsed.repo,
        inputText: text,
        duplicatesJson: result,
      })
      .returning();
    return { checkId: check!.id, candidates: result };
  }
  const templates = await gh.listIssueTemplates(owner, repo);
  const template = templates.templates.find((t) => t.id === parsed.templateId);
  if (parsed.templateId && !template) throw new AppError('template_not_found', 404);
  if (kind === 'issue.quality')
    return (
      await ctx.provider.completeJSON({
        tier: 'fast',
        system: prompts.issueQuality(lang),
        user: prompts.untrusted({
          title: 'title' in parsed ? parsed.title : '',
          body: 'body' in parsed ? parsed.body : '',
          template,
        }),
        schema: IssueQuality,
      })
    ).data;
  if (kind === 'issue.draft') {
    await ctx.onProgress?.({ progress: { stage: 'drafting' } });
    const result = await ctx.provider.completeJSON({
      tier: 'mode' in parsed && parsed.mode === 'deep' ? 'deep' : 'fast',
      system: prompts.issueDraft(lang),
      user: prompts.untrusted({
        description: 'text' in parsed ? parsed.text : '',
        answers: 'answers' in parsed ? parsed.answers : {},
        template,
        readme: readme.body.slice(0, 10000),
      }),
      schema: IssueDraft,
    });
    return { ...result.data, lang, templateId: parsed.templateId };
  }
  throw new AppError('unknown_job', 400);
}
