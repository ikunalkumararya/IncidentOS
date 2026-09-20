FROM node:22-bookworm-slim AS base
RUN npm install -g pnpm@10.18.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --prod=false

FROM base AS api
ENV NODE_ENV=production
RUN mkdir -p /app/.sandbox /app/recordings && chown -R node:node /app
USER node
EXPOSE 4000
CMD ["pnpm", "--filter", "@incident-os/server", "start"]

FROM base AS web
ARG PUBLIC_ORIGIN
ENV NEXT_PUBLIC_API_BASE=${PUBLIC_ORIGIN}
RUN test -n "$PUBLIC_ORIGIN" && pnpm --filter @incident-os/web build
ENV NODE_ENV=production
RUN chown -R node:node /app
USER node
EXPOSE 3000
CMD ["pnpm", "--filter", "@incident-os/web", "exec", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
