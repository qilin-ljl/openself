# Deployment

This repository includes deployment configuration. No production deployment is claimed until real credentials, services and the live checks below are available.

## Vercel Web + Railway Worker

1. Push this repository to an account you control. Create a Vercel project with **Root Directory `apps/web`**, allowing access to workspace files outside that directory. Its `vercel.json` installs from the workspace root and builds the Web app.
2. Create PostgreSQL 16 and Redis 7 services. Use a pooled PostgreSQL connection URL for Web serverless instances when the database provider offers one.
   Use a direct or session-pooled connection for Worker migrations; a transaction-pooling URL cannot preserve the session-level migration lock.
3. Deploy the Worker from the repository root using `railway.json`. Its Dockerfile runs database migrations before starting the publication, AI and radar workers. Migration execution uses a PostgreSQL advisory lock to serialize concurrent deployments.
4. Configure all values from `.env.example` in both services. `APP_URL` must be the production HTTPS origin. Use a new 32-byte encryption key and a separate production GitHub OAuth App whose callback is `APP_URL/api/auth/github/callback`.
5. Every user, including the instance owner, must save their own DeepSeek API key in Settings. Web and Worker do not use `DEEPSEEK_API_KEY` or fall back to another user's key. Model IDs and thinking mode remain configurable. Do not put secrets in the image or Git repository.
6. After building the browser extensions for the production URL, add their exact Chrome and Edge IDs to `EXTENSION_IDS`. Restart the Web service after changing the allowlist.

Do not deploy the development fixture flag `E2E_FAKE_AUTH`. The fixture route rejects production requests even if this flag is accidentally present.

## Self-managed infrastructure

`docker-compose.production.yml` supplies Worker, PostgreSQL and Redis without publishing database/cache ports. Create an ignored `.env.production`, set its database/cache hosts to `postgres` and `redis`, and set `POSTGRES_PASSWORD` for Compose interpolation. Run:

```sh
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
```

The Web app can still run on Vercel, but it needs a network-accessible database connection; Docker's internal `postgres` hostname is only usable by containers on that network. For a fully private database, host Web on the same network instead. These deployment configurations have not been executed on this machine because Docker and cloud account configuration are unavailable.

## Release checks

- Apply migrations and confirm the Worker connects to PostgreSQL and Redis.
- Sign in using the production OAuth App; verify sign-out and revocation.
- On your own test repository, create one issue and one review with three inline comments. Confirm retries do not duplicate publications.
- Run an AI review, verify usage and private-repository consent, then inspect the draft before publication.
- Check the daily radar schedule (07:00 Asia/Shanghai).
- Configure encrypted database backups and restrict database/cache networking to the application services.
- Have three invited users complete sign-in and a review before declaring the multi-user release accepted.

## Operational behavior

Queues use Redis; approved publications and AI jobs also have durable PostgreSQL state. Workers reconcile queued work after temporary queue outages. AI jobs heartbeat and retry once; exhausted interrupted jobs are shown as failed. Publication outcomes that are uncertain remain locked for manual reconciliation, avoiding duplicate posts.

AI usage is recorded per user in PostgreSQL. Each model response contributes input/output usage, including format-retry attempts. The settings page shows the user's key status and recent usage. Requests without a personal key fail before enqueueing; workers reject legacy platform-funded jobs and jobs whose personal key was removed. Existing historical platform usage remains visible but does not grant further access.

Logs contain event codes and internal IDs, not repository bodies, tokens or API keys. External error monitoring is optional and is not configured by default.
