# OpenSelf v0.3 release status

Updated: 2026-11-07.

## v0.3 implementation and verification

The v0.3 implementation adds model-default output budgets (no max_tokens parameter), project-aware inspection plans, selectable scopes and fast/deep modes, declaration-based source excerpts, proposal-specific context, two concurrent scan batches, persisted per-batch checkpoints/cache, job history, cancellation/resume and active-job deduplication. Issue drafting defaults to fast mode. PR review/approval/merge distinctions are clarified; merging remains on GitHub.

At the user's explicit request, automated tests, browser tests and live AI calls were NOT run for v0.3. Workspace type checking, lint and production build pass. A user-reported task-list 404 was diagnosed with a narrowly scoped authenticated read: after introducing dedicated job routes, the API returned HTTP 200 with 20 existing records. No AI task was submitted during that diagnosis; the temporary diagnostic session was revoked. The historical 147-test and browser/live results below belong to v0.2 and are not v0.3 acceptance evidence. Existing v0.2 test fixtures may need adaptation to the new planning stage and defaults. Source selection uses bounded manifests, sampled symbol outlines and heuristic direct-import relationships; it does not build a complete semantic dependency graph. Cache reuse is scoped to the same user and pinned commit, not arbitrary changed commits.

Draft queue extension: separate issue, authored PR and review categories; user-scoped server-side search over titles, bodies, repositories, URLs and numbers; paginated history; separate read-only GitHub state lookups for published items. Review entries track the target PR. Access failures remain unknown instead of implying closed/merged. This extension follows the same requested verification scope: no new tests and no test suite execution.

Code-generation repair: context selection now prioritizes explicitly mentioned files and nearby module manifests/configuration, up to eight files. Dependency manifest/config edits are permitted when justified; generated lockfiles, credentials and workflows remain excluded. Empty proposals and no-op edits have distinct errors and retain the model explanation, without automatically repeating an unchanged no-op request. The editor offers clarification, re-preparation and Issue fallback. No new tests or live model replay were performed for this repair; historical failure details were not retained and cannot be reconstructed exactly.

## Historical v0.2 verification



The current delivery target is the local edition. It does not require public hosting and has no test-repository publication restriction. Cloud deployment and store submission are optional future work; verification limits are recorded below.

| Area | Implemented | Verification |
| --- | --- | --- |
| GitHub account and workspace | OAuth, encrypted credentials, Web/extension sessions, repository browsing and dashboard repository shortcuts | Unit/integration tests, fixture browser flows and real local GitHub sign-in; owned-repository cards verified against the live account |
| Issues | Markdown/Issue Forms, duplicate search, AI drafting and follow-ups, quality, translation, drafts and approval | Fixture flows and a real AI-assisted issue published after user approval |
| PR review | Split/unified diff, manual comments, AI risk scoring and review, rule cards, accepted findings, stale-head/self-review protection | Fixture flows; real risk scoring and one COMMENT review with three inline comments |
| Personalization and usage | Style profiles, edit feedback, learning mode, mandatory personal keys, daily totals and per-job reported usage/duration | Key isolation/removal/legacy-job tests; settings save/delete browser flow |
| Radar | Language-based public tasks, participation exclusions, daily 07:00 Asia/Shanghai worker schedule | Selection tests; daily scheduler registered in real Redis; scheduled execution not yet observed |
| AI contributions | Natural-language project discovery, bounded public-source scans with evidence, code previews, Issue handoff, approved branch/fork/PR creation | Policy and API tests, fixture browser flow through PR publication, real project discovery; live scan verification recorded below |
| Deployment | Vercel configuration, Railway Worker Dockerfile, Compose, serialized migrations, CI checks, privacy pages | Production build succeeds; local Docker PostgreSQL/Redis healthy, migrations and worker ping pass; cloud deployment not executed |
| Chrome/Edge extension | Side panel, code-line navigation, AI drafts, safe form filling, single-use code exchange and origin controls | Both bundles and ZIPs build; Edge native integration exercised with fixture services |
| Store handoff | Icons, 440×280 promotion, 1280×800 screenshots, Chinese/English copy and privacy page implementation | Files inspected; not uploaded to stores |

## Verified results

- 147 unit/integration tests pass, including contribution evidence validation, exact source edits, protected paths, branch/fork writes, stale repository identity/version, prepared-job ownership and uncertain multi-step publication outcomes, plus the existing authentication, publication, review and personal-key checks. Format regressions cover exact array limits, per-batch fallback, preservation of earlier findings, honest incomplete coverage, propagation of credential errors and the deep scan output budget.
- 14 desktop Playwright flows pass, including idea discovery → source scan → code preview → approved draft PR publication with isolated fixture transports. Existing dashboard, personal-key, issue, review, anonymous-access and extension flows also pass.
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

## AI contribution limits

Discovery ranks only repositories returned by GitHub. Matching reasons and improvement directions are model suggestions, not verified defects or promises of maintainer acceptance. A real personal-key discovery on 2026-11-07 returned five public repository recommendations. A real scan of `qilin-ljl/linli-share` at commit `049af18b` analyzed ten files and returned five evidence-linked candidates; these counts are a smoke check, not an accuracy score. Real code generation then prepared Escape-key handling and listener cleanup in `frontend/src/AuthDialog.tsx`; the diff was previewed and saved as an unapproved local PR draft. No new branch or PR was posted during this smoke check.

Repository scans are public-only and read a pinned default-branch commit. The default budget is 20 files (UI choices 10/20/50/100), at most 400 lines / 16,000 characters per file and 160,000 characters total. Coverage and skipped files are visible. Findings must cite actual code at the claimed line; static evidence alone does not establish runtime correctness. Code generation prepares at most five files using exact source context. No target repository code, dependency installation or tests are executed.

If deep-model output remains invalid after its format retry, only that batch is retried with the fast model. If validation still fails, its files are explicitly marked as incomplete and excluded from analyzed coverage; valid results from other batches are retained. An incomplete report is not a clean scan, including when every batch fails. Credential failures still surface as errors.

A live diagnostic observed an empty answer with `finish_reason: length` and 8,000 completion tokens. In v0.2, deep scan calls were changed to allow up to 16,000 output tokens, matching the provider's default deep budget; this raises the possible per-call usage and does not guarantee every response will validate. The exact malformed response from the older failed task was not retained.

Publication rechecks repository ID, default branch, base commit and file identities. It creates a separate branch, using the viewer's fork when upstream is not writable, and defaults to a draft PR. There is no automatic merge. A confirmed intermediate write followed by failure is marked uncertain and cannot be blindly republished; the user may need to inspect a created fork/branch on GitHub. Real external fork/PR creation for this new flow has not been exercised; its write behavior is verified using isolated GitHub fixtures.

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
