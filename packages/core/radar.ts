import { type Database, eq, and, gte, schema } from '@openself/db';
import type { Workspace } from './workspace';
import type { User } from './drafts';
import { beijingDate } from './ai-billing';
export type RadarItem = {
  number: number;
  title: string;
  url: string;
  repo: string;
  language: string;
  updatedAt: string;
};
export function topLanguages(repos: { language: string | null }[]) {
  const counts = new Map<string, number>();
  for (const repo of repos)
    if (repo.language) counts.set(repo.language, (counts.get(repo.language) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([language]) => language);
}
export function rankRadar(items: RadarItem[]) {
  return [...new Map(items.map((i) => [i.url, i])).values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);
}
export function createRadar(db: Database, workspace: Workspace) {
  return {
    async get(user: User, refresh = false) {
      const date = beijingDate();
      const [cached] = await db
        .select()
        .from(schema.radarItems)
        .where(and(eq(schema.radarItems.userId, user.id), eq(schema.radarItems.date, date)));
      if (cached && !refresh) return { date, items: cached.itemsJson as RadarItem[] };
      const gh = await workspace.githubFor(user.id),
        repos = await gh.getUserRepos(),
        languages = topLanguages(repos.filter((r) => !r.private || user.privateRepoEnabled));
      const items: RadarItem[] = [];
      for (const language of languages) {
        const result = await gh.searchIssues(
          `is:open is:issue is:public no:assignee label:"good first issue" language:"${language.replaceAll('"', '')}" -involves:${user.login}`,
          1,
          'updated',
        );
        for (const i of result.items)
          if (i.user?.login !== user.login && !i.assignee)
            items.push({
              number: i.number,
              title: i.title,
              url: i.html_url,
              repo: new URL(i.html_url).pathname.split('/').slice(1, 3).join('/'),
              language,
              updatedAt: i.updated_at,
            });
      }
      const ranked = rankRadar(items);
      await db
        .insert(schema.radarItems)
        .values({ userId: user.id, date, itemsJson: ranked })
        .onConflictDoUpdate({
          target: [schema.radarItems.userId, schema.radarItems.date],
          set: { itemsJson: ranked },
        });
      return { date, items: ranked };
    },
    async activeUsers() {
      return db
        .selectDistinct({ id: schema.users.id })
        .from(schema.users)
        .innerJoin(schema.sessions, eq(schema.users.id, schema.sessions.userId))
        .where(gte(schema.sessions.lastSeenAt, new Date(Date.now() - 7 * 86400000)));
    },
  };
}
