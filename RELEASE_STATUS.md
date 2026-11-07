# OpenSelf v0.1 release status

Updated: 2026-11-07.

The current delivery target is the local edition. It does not require public hosting and has no test-repository publication restriction. Cloud deployment and store submission are optional future work; verification limits are recorded below.

| Area | Implemented | Verification |
| --- | --- | --- |
| GitHub account and workspace | OAuth, encrypted credentials, Web/extension sessions, repository browsing and dashboard repository shortcuts | Unit/integration tests, fixture browser flows and real local GitHub sign-in; owned-repository cards verified against the live account |
| Issues | Markdown/Issue Forms, duplicate search, AI drafting and follow-ups, quality, translation, drafts and approval | Fixture flows and a real AI-assisted issue published after user approval |
| PR review | Split/unified diff, manual comments, AI risk scoring and review, rule cards, accepted findings, stale-head/self-review protection | Fixture flows; real risk scoring and one COMMENT review with three inline comments |
| Personalization and usage | Style profiles, edit feedback, learning mode, mandatory personal keys, daily totals and per-job reported usage/duration | Key isolation/removal/legacy-job tests; settings save/delete browser flow |
| Radar | Language-based public tasks, participation exclusions, daily 07:00 Asia/Shanghai worker schedule | Selection tests; daily scheduler registered in real Redis; scheduled execution not yet observed |
| Deployment | Vercel configuration, Railway Worker Dockerfile, Compose, serialized migrations, CI checks, privacy pages | Production build succeeds; local Docker PostgreSQL/Redis healthy, migrations and worker ping pass; cloud deployment not executed |
| Chrome/Edge extension | Side panel, code-line navigation, AI drafts, safe form filling, single-use code exchange and origin controls | Both bundles and ZIPs build; Edge native integration exercised with fixture services |
| Store handoff | Icons, 440×280 promotion, 1280×800 screenshots, Chinese/English copy and privacy page implementation | Files inspected; not uploaded to stores |

## Verified results

- 103 unit/integration tests pass, covering local cross-repository publication, GitHub permission denials, owned repository filtering and private access, encrypted storage, sessions, personal-key isolation, duplicate publication, stale PRs, AI validation, private-data consent, ownership, extension codes and URL handling.
- 13 desktop Playwright flows pass, including dashboard repository shortcuts into PR review, personal-key setup/removal, manual/AI issues and reviews, anonymous access restrictions, extension bearer authorization and native form setters that never submit.
- Lint, all workspace type checks, Web/Worker build and Chrome/Edge extension builds pass.
- Real DeepSeek smoke calls returned valid JSON with thinking enabled and disabled. This validates protocol compatibility, not review accuracy.
- The unpacked Edge extension loaded successfully. With a preauthenticated fixture Web session, its real `launchWebAuthFlow` completed; the side panel accepted findings, navigated to the corresponding code line, saved a review draft and filled issue fields without firing a submit event.
- The installed Chrome did not expose an extension service worker in the headless loading attempt. Chrome's compiled package and shared logic are verified; native Chrome runtime acceptance remains a handoff item.
- Local setup on 2026-11-07: WSL 3.0.3 and Docker Desktop are running. PostgreSQL 16 and Redis 7 report healthy; migrations created all 16 public tables. A real BullMQ health job completed with `ok: true`, and the daily radar schedule is registered in Redis.
- Real Web and Worker use fixture authentication disabled. The Chinese homepage returns 200, anonymous `/api/me` returns 401, and the sign-in route redirects to GitHub with the expected localhost callback. The user completed real GitHub sign-in as `qilin-ljl`; the current owned integration repository is `qilin-ljl/linli-share`.
- At the user's request, Web and Worker only use each account's saved personal DeepSeek key. Server environment keys are ignored, removed/invalid keys never fall back, and legacy platform-funded jobs are refused. The existing local owner's key is encrypted and bound only to that owner's account.
- Local-edition startup was exercised through `Start-OpenSelf.cmd`. Web returned 200, the fixture login remained disabled, and the real Worker health response confirmed `publicationMode: github-permissions`. Cross-repository issue/review publication and permission denial behavior are covered by isolated API tests; no unsolicited third-party test issues were posted.

On 2026-11-07, after the user approved the exact draft contents, OpenSelf published [issue #2](https://github.com/qilin-ljl/linli-share/issues/2) and [one COMMENT review with three inline comments](https://github.com/qilin-ljl/linli-share/pull/1#pullrequestreview-5811012371). GitHub readback confirmed the issue, review, comment paths and lines. PR #1 was a draft at publication; a later readback during dashboard verification shows it has since been merged. Real AI drafting and risk scoring completed using the owner's personal key. Both PR files scored below the deep-review threshold, so zero files received deep review; this does not validate finding accuracy.

Fixture GitHub/DeepSeek requests use explicit transport adapters so test credentials cannot escape to those real services. Screenshots containing fixture content are labeled as demo data. No OpenSelf production deployment or store submission occurred.

## External gates still requiring configuration or human evidence
These items describe additional quality evaluation or optional hosting/distribution work. They do not restrict local publication to a particular repository.

1. Exercise deep review on real code changes selected by the risk filter. The owned-repository issue and three-comment review publication gate is complete.
2. Exercise real queue recovery. Local PostgreSQL 16, Redis 7, migrations and queue delivery now pass; no remote CI run has been executed here.
3. Annotate results on five real public PRs to evaluate the planned 40% acceptance target. No acceptance percentage has been invented from fixture tests.
4. Supply and verify twenty real duplicate-issue pairs to evaluate the planned 15/20 target. Fixture tests do not establish this accuracy.
5. Deploy to configured cloud accounts with production OAuth credentials, then have three external users complete the live flow.
6. Rebuild extensions with the actual HTTPS `WXT_APP_URL`, register their final IDs, verify real-account sign-in in Chrome/Edge, and submit through the publisher's store accounts using the live privacy/support URLs.

See [README](README.md), [deployment steps](DEPLOYMENT.md), [extension installation](apps/extension/README.md) and [store copy](apps/extension/store/LISTING.md).

The public repository includes cloud CI as an optional template; GitHub Actions is not enabled by this source upload.
