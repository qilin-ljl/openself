# OpenSelf

A bilingual GitHub contribution workspace. Issues, review comments and new pull requests are drafts until a user explicitly approves publication.

初次使用请打开 [中文操作手册](docs/OpenSelf-操作手册.html)：从保存第一份草稿开始，逐步学习个人 API Key、Issue、PR 审查、AI 找项目与生成代码改动。下载到本地后可直接用浏览器打开，也可打印为 PDF。

登录后，工作台上方的「我的仓库」会显示当前 GitHub 账号名下的仓库，点击即可直接查看该仓库的 PR，不必再搜索自己的项目。

顶部「AI 贡献」提供两个入口：用自然语言描述想法，AI 根据真实 GitHub 搜索和 README 推荐项目；或者输入公开仓库，扫描源代码并给出带文件、行号、证据和验证步骤的改进候选。每条候选可继续起草 Issue，或生成代码改动预览。检查差异、标题和正文，保存 PR 草稿，再到草稿队列确认发布；有写权限时创建独立分支，否则在自己的 fork 中创建分支并向原仓库提 PR。默认创建草稿 PR，不自动合并。

仓库体检只支持公开仓库，默认最多分析 20 个文件（可选 10/20/50/100），每文件最多 400 行、16,000 字符，总计最多 160,000 字符。页面会列出覆盖范围和跳过原因。结果是静态分析候选，不保证缺陷成立；生成改动最多涉及 5 个文件，不执行目标仓库的代码或测试。密钥、工作流、二进制和生成文件等会跳过。发布前发现源仓库版本变化时需重新扫描。

## Current status

OpenSelf is delivered as a local application: GitHub authentication and browsing, manual and AI PR review, repository rule cards, review style learning, issue duplicate checks/drafting/quality/translation, approval queues, usage statistics, contribution radar, and a Chrome/Edge side panel. Local use is not restricted to a test repository; GitHub permissions and explicit draft approval still apply. Real sign-in and approved issue/review publication have been verified locally. Cloud deployment and store submission are optional future work, not requirements for this local edition. See [RELEASE_STATUS.md](RELEASE_STATUS.md) for verification coverage.

## 先看界面（不用配置账号）

```powershell
pnpm install --frozen-lockfile
pnpm preview
```

打开 http://localhost:3000/zh 。可查看中英文首页。这个模式没有模拟账号，也不会绕过登录；实际登录需要下方配置。

## 本地完整启动

需要 Node.js 22+（推荐 24）、pnpm 11.25.0、Docker Desktop。

已经完成首次配置后，在 Windows 中先打开 Docker Desktop，再双击根目录的 [Start-OpenSelf.cmd](Start-OpenSelf.cmd)。它会寻找本机 Node、pnpm 和 Docker（本机开发工具附带的 pnpm 也可识别），启动数据库、应用迁移，并一起运行网站与后台。使用期间保留窗口，停止时按 Ctrl+C；更新后先关闭旧服务再启动，避免同时运行两套进程。

本地版没有指定测试仓库限制：可向当前 GitHub 账号有权限操作的仓库提交 Issue 和已有 PR 的审查。GitHub 权限、私有仓库授权、草稿人工确认和防重复发布仍然生效。下面是首次配置或手动启动流程。

1. 启动 Docker Desktop。
2. 在项目根目录执行 `pnpm setup:env`，会创建 `.env` 并自动生成加密密钥。已有文件不会被覆盖。
3. 创建 GitHub OAuth App：打开 <https://github.com/settings/developers>，选择 **OAuth Apps → New OAuth App**。
   - Application name: `OpenSelf Local`
   - Homepage URL: `http://localhost:3000`
   - Redirect URI（部分界面显示 Authorization callback URL）: `http://localhost:3000/api/auth/github/callback`
   - 将 Client ID 和生成的 Client Secret 填进本机 `.env`。不要发送到聊天或提交到 Git。
4. `ENCRYPTION_KEY` 已由上一步自动生成，不需要手动填写。
5. 不需要配置 `DEV_TEST_REPO`。旧版本的此项配置不再生效；首次练习仍建议只在自己的仓库保存草稿。
6. 启动基础服务、执行迁移、启动应用：

   ```powershell
   docker compose up -d
   pnpm db:migrate
   pnpm dev
   ```

7. 打开 http://localhost:3000/zh 并用 GitHub 登录；成功后显示 GitHub 头像和账号。
8. 另开终端执行 `pnpm worker:ping`，应返回 `ok: true`。

AI 功能要求每个用户登录后在「设置 → AI 与审查设置」填写自己的 DeepSeek API Key，费用由各自的 DeepSeek 账户承担。Key 按用户隔离、加密保存，界面只显示末四位；未配置或删除后仍可浏览项目、手动编写 Issue 和审查 PR。Web 和 Worker 不会使用服务器环境里的 `DEEPSEEK_API_KEY` 作为兜底，旧的平台 Key 任务也会被拦截。该环境变量仅供开发者主动运行模型 smoke 脚本使用。

`.env` 由启动脚本从仓库根目录加载。正常 `dev` / `start` 会校验必需配置并在缺失时退出；`preview` 仅供公开页面检查。构建不需要真实密钥。线上必须使用 HTTPS 的 APP_URL，并单独创建生产 OAuth App。

## Commands

| Command            | Purpose                                                |
| ------------------ | ------------------------------------------------------ |
| `pnpm dev`         | Web + health worker                                    |
| `pnpm preview`     | Public landing page without credentials                |
| `pnpm db:generate` | Generate reviewed SQL migrations                       |
| `pnpm db:migrate`  | Apply migrations to DATABASE_URL                       |
| `pnpm lint`        | ESLint + untranslated JSX check                        |
| `pnpm typecheck`   | Check all workspace packages                           |
| `pnpm test`        | Unit tests and embedded Postgres/MSW integration tests |
| `pnpm test:e2e`    | Chromium desktop public-page checks                    |
| `pnpm build`       | Production Web build + worker type check               |
| `pnpm worker:ping` | Round-trip health job through real Redis and worker    |

Before the first E2E run: `pnpm exec playwright install chromium`.

If Chrome is already installed, PowerShell can use it directly: `$env:PLAYWRIGHT_CHANNEL='chrome'; pnpm test:e2e`.

Only desktop Web pages are in scope following the user's clarification; mobile pages and mobile testing are excluded.

## Structure

`apps/web` contains Next.js pages and authenticated APIs. `apps/worker` consumes publication, AI, style and radar queues. `apps/extension` contains the WXT Chrome/Edge side panel and narrowly scoped issue-filling content script. Shared packages contain database schemas/migrations, application services, GitHub and DeepSeek clients, contracts, translations and UI.

## Authentication and storage

- Arctic implements the GitHub OAuth exchange. `state` is compared with a short-lived HttpOnly cookie. Return destinations are restricted to local locale-prefixed paths.
- Opaque 32-byte random sessions are persisted in PostgreSQL. Cookies are HttpOnly, SameSite=Lax and Secure on HTTPS. Sign-in rotates the prior session; sessions expire after 30 days.
- Every protected page and API validates the session server-side. `proxy.ts` handles locale routing, not authorization decisions.
- Cookie-authenticated write routes require an exact matching Origin. GitHub access tokens are encrypted with AES-256-GCM and a random IV. API output does not contain credentials.
- Revoke calls GitHub first, then removes local credentials, sessions and extension authorization codes. Failed remote revocation does not claim success.
- The development-only fixture login returns 404 in production. Tests use real application services with embedded PostgreSQL; an explicit transport adapter serves GitHub/DeepSeek fixtures without sending fixture credentials to real services.

## Compatibility decisions

- Next.js 16 uses `proxy.ts` instead of the plan's older `middleware.ts` filename.
- TypeScript uses the newest stable 6.0 version supported by the current TypeScript ESLint parser; TypeScript 7 is not supported by that parser yet.
- Arctic 3.7 is the plan-requested dependency but is now marked deprecated upstream. Its OAuth integration is covered by network-level tests; reassess maintenance before production release.
- DeepSeek model names remain configurable. A real smoke test confirmed JSON output with deep thinking enabled and disabled. This protocol test does not establish review accuracy or duplicate-detection quality.
- Embedded PostgreSQL tests do not replace acceptance against Docker PostgreSQL 16 and Redis 7.

## Publication behavior

The approve API persists an approved draft and enqueues a BullMQ job. The worker reconciles approved rows every 30 seconds, so a temporary Redis outage does not lose approvals. A transaction locks the user and draft, enforces issue limits (10/hour/user, 5/Beijing-calendar-day/repository/user), and reserves the draft before sending anything. Duplicate jobs cannot claim a publishing/published draft.

GitHub POSTs are never automatically retried. An uncertain network/server outcome remains locked with `publication_unknown`; check GitHub before any manual recovery. A crashed worker can likewise leave a publishing row requiring reconciliation. This intentionally avoids claiming exactly-once delivery across two independent systems. Definitive validation errors return an editable failed draft. If a repository form changes its generated body after approval, publication stops with `template_changed`.

Only AI-assisted content receives an AI disclosure. M1's manually authored issues do not make a false AI attribution. Labels are omitted when the user lacks repository write permission.

PR reviews support split/unified diff views, LEFT/RIGHT inline comments, a summary and COMMENT / APPROVE / REQUEST_CHANGES decisions. The server re-fetches the PR head before publication and blocks stale reviews. Self-approval and self-request-changes are rejected server-side. Non-commentable coordinates are moved into the summary, preserving the user's text. Missing binary/large-file patches and truncated file lists are explicitly indicated. All comments are published together as one review.

End-to-end tests start an explicit development-only fixture environment with an embedded PostgreSQL database and fixture transports. Publication uses the real application service in-process instead of real Redis. `/api/auth/test` returns 404 in production even when the test flag is set. CI additionally provisions PostgreSQL/Redis for migration and worker ping checks; this remote CI run has not been executed here.

## AI and extensions

The review worker scores files, skips generated/binary content, retrieves repository conventions, reviews selected patches with concurrency three, validates coordinates, merges duplicates, filters weak findings and optionally rewrites wording. Users accept/edit/reject results before creating publication drafts. Private repository AI processing requires explicit consent. Learning mode hides AI findings until the user chooses to compare.

Issue checks, drafting, follow-up questions, quality scoring and translation run as durable background jobs. Style profiles can be edited manually or rebuilt from authorized history; twenty recorded edits trigger a rebuild. AI job results store reported token usage and elapsed processing time. Settings show daily review/draft/publication totals and token usage. Radar runs daily at 07:00 Asia/Shanghai for recently active users.

See [extension installation](apps/extension/README.md), [deployment](DEPLOYMENT.md) and [store listing materials](apps/extension/store/LISTING.md). `pnpm dev` starts Web and Worker only; `pnpm --filter extension dev` is a separate interactive extension development command. Use `pnpm extension:build` or `pnpm extension:zip` to produce both browser targets.

Original planning materials and local development logs are kept outside this public release.


## Public local-edition release

This repository contains the runnable source, tests, configuration examples, documentation and extension assets. Configure your own GitHub OAuth App and each user's personal API key using the setup steps above. Local credentials, databases, runtime files and development-session notes are not included.

The Chinese operation manual includes the author's local paths and sample repositories; substitute your own paths and account when using it on another computer.

The optional GitHub Actions configuration is provided as [a CI template](docs/github-actions-ci.yml.example). No cloud workflow is enabled in this release. To enable it later, place the template at .github/workflows/ci.yml using an account/token with the required workflow permissions. See [GitHub's OAuth scope documentation](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps).
