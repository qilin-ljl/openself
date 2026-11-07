import { NextRequest } from 'next/server';
import {
  PageNumber,
  RepositoryName,
  DraftStatus,
  z,
  type OwnedRepositoryDTO,
} from '@openself/shared/api';
import { AppError } from '@openself/shared/errors';
import { draftDTO } from '@openself/core/drafts';
import { authenticated, body, respond, preflight } from '../../../lib/request';
import { getWorkspace } from '../../../lib/workspace';
import { getAI } from '../../../lib/ai';
import { createRadar } from '@openself/core/radar';
import { getRuntime } from '../../../lib/runtime';
async function route(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return respond(async () => {
    const user = await authenticated(request),
      { path } = await params,
      workspace = getWorkspace(),
      query = request.nextUrl.searchParams,
      method = request.method;
    const github = await workspace.githubFor(user.id);
    const page = () => PageNumber.parse(query.get('page') ?? undefined);
    if (path.length === 1 && method === 'POST') {
      if (path[0] === 'discover-projects') return getAI().discover(user, await body(request));
      if (path[0] === 'scan-repository') return getAI().scan(user, await body(request));
      if (path[0] === 'prepare-change') return getAI().prepareChange(user, await body(request));
    }
    if (path[0] === 'scans' && path.length === 4 && path[2] === 'findings' && method === 'GET')
      return getAI().findingContext(user, z.uuid().parse(path[1]), z.uuid().parse(path[3]));
    if (path[0] === 'radar' && path.length === 1 && method === 'GET')
      return createRadar(getRuntime().db, workspace).get(user);
    if (path[0] === 'reviews') {
      const ai = getAI();
      if (path.length === 1 && method === 'POST') return ai.startReview(user, await body(request));
      const id = z.uuid().parse(path[1]);
      if (path.length === 2 && method === 'GET') return ai.getReview(user.id, id);
      if (path.length === 4 && path[2] === 'findings' && method === 'PATCH')
        return ai.editFinding(user, id, z.uuid().parse(path[3]), await body(request));
    }
    if (path[0] === 'jobs' && path.length === 2 && method === 'GET')
      return getAI().getJob(user.id, z.uuid().parse(path[1]));
    if (
      path[0] === 'issues' &&
      path.length === 2 &&
      method === 'POST' &&
      ['check', 'draft', 'quality'].includes(path[1]!)
    )
      return getAI().issue(
        user,
        ('issue.' + path[1]) as 'issue.check' | 'issue.draft' | 'issue.quality',
        await body(request),
      );
    if (path[0] === 'translate' && path.length === 1 && method === 'POST')
      return getAI().translate(user, await body(request));
    if (path[0] === 'me' && path[1] === 'repos' && path.length === 2 && method === 'GET') {
      const repositories = await github.getUserRepos();
      const items: OwnedRepositoryDTO[] = repositories
        .filter(
          (repo) =>
            repo.owner.login.toLowerCase() === user.login.toLowerCase() &&
            (!repo.private || user.privateRepoEnabled),
        )
        .map((repo) => ({
          id: repo.id,
          fullName: repo.full_name,
          description: repo.description,
          language: repo.language,
          private: repo.private,
          archived: repo.archived,
          updatedAt: repo.updated_at,
        }));
      return { items };
    }
    if (path[0] === 'me') {
      const ai = getAI();
      if (path[1] === 'ai' && method === 'GET') return ai.settings(user.id);
      if (path[1] === 'api-key' && method === 'PUT')
        return ai.setKey(user.id, z.object({ key: z.string() }).parse(await body(request)).key);
      if (path[1] === 'api-key' && method === 'DELETE') return ai.removeKey(user.id);
      if (path[1] === 'style-profile' && path[2] === 'rebuild' && method === 'POST')
        return ai.rebuildStyle(user);
      if (path[1] === 'style-profile' && method === 'GET')
        return (await ai.settings(user.id)).style;
      if (path[1] === 'style-profile' && method === 'PUT')
        return ai.saveStyle(user.id, await body(request));
    }
    if (path[0] === 'repos' && path[1] === 'search' && method === 'GET') {
      const q = z.string().trim().min(1).max(200).parse(query.get('q'));
      return github.searchRepos(q + (user.privateRepoEnabled ? '' : ' is:public'), page());
    }
    if (path[0] === 'repos' && path.length >= 3) {
      const [owner, repo] = RepositoryName.parse(path[1] + '/' + path[2]).split('/') as [
        string,
        string,
      ];
      const repository = await workspace.assertRepo(user, owner, repo);
      if (method === 'GET' && path.length === 3) {
        const [readme, contributing] = await Promise.all([
          github.getReadme(owner, repo),
          github.getContributing(owner, repo),
        ]);
        return { repository, readme, contributing };
      }
      if (method === 'GET' && path[3] === 'issue-templates')
        return github.listIssueTemplates(owner, repo);
      const state = z.enum(['open', 'closed']).parse(query.get('state') ?? 'open');
      if (method === 'GET' && path[3] === 'issues')
        return github.listIssues(owner, repo, state, page());
      if (method === 'GET' && path[3] === 'pulls' && path.length === 5) {
        const n = z.coerce.number().int().positive().parse(path[4]);
        const pull = await github.getPull(owner, repo, n);
        const files = await github.listPullFiles(owner, repo, n);
        let checks: Awaited<ReturnType<typeof github.getCheckRuns>>['check_runs'] = [],
          checksUnavailable = false;
        try {
          checks = (await github.getCheckRuns(owner, repo, pull.head.sha)).check_runs;
        } catch (error) {
          if (error instanceof AppError && ['forbidden', 'not_found'].includes(error.code))
            checksUnavailable = true;
          else throw error;
        }
        return { pull, ...files, checks, checksUnavailable, viewerLogin: user.login };
      }
      if (method === 'GET' && path[3] === 'pulls' && path.length === 4)
        return github.listPulls(owner, repo, state, page());
    }
    if (path[0] === 'drafts') {
      if (path.length === 1 && method === 'GET') {
        const status = query.get('status');
        return {
          items: (
            await workspace.drafts.list(user.id, status ? DraftStatus.parse(status) : undefined)
          ).map(draftDTO),
        };
      }
      if (path.length === 1 && method === 'POST')
        return draftDTO(await workspace.drafts.create(user, await body(request)));
      const id = z.uuid().parse(path[1]);
      if (path.length === 2 && method === 'GET')
        return draftDTO(await workspace.drafts.find(user.id, id));
      if (path.length === 2 && method === 'PATCH')
        return draftDTO(await workspace.drafts.update(user, id, await body(request)));
      if (path.length === 2 && method === 'DELETE')
        return draftDTO(await workspace.drafts.discard(user.id, id));
      if (path.length === 3 && path[2] === 'approve' && method === 'POST')
        return draftDTO(await workspace.drafts.approve(user.id, id));
    }
    if (path[0] === 'audit' && path.length === 1 && method === 'GET')
      return { items: await workspace.drafts.audit(user.id, page()) };
    if (path[0] === 'dashboard' && path.length === 1 && method === 'GET') {
      const [requested, mine, count] = await Promise.all([
        github.searchIssues(
          'is:pr is:open review-requested:' +
            user.login +
            (user.privateRepoEnabled ? '' : ' is:public'),
        ),
        github.searchIssues(
          'is:pr is:open author:' + user.login + (user.privateRepoEnabled ? '' : ' is:public'),
        ),
        workspace.drafts.counts(user.id),
      ]);
      return { requested: requested.items, mine: mine.items, draftCount: count };
    }
    throw new AppError('not_found', 404);
  }, request);
}
export { route as GET, route as POST, route as PATCH, route as DELETE, route as PUT };
export { preflight as OPTIONS };
