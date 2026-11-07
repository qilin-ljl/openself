FROM node:24-bookworm-slim
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
ENV NODE_ENV=production
CMD ["sh", "-c", "pnpm db:migrate && pnpm --filter worker start"]
