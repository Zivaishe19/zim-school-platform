# syntax=docker/dockerfile:1.7
# Two images from one Dockerfile:
#   --target app  : the Next.js web server (standalone output, no dev dependencies)
#   --target ops  : provisioning, migrations, health checks and backups (has tsx + pg_dump)
# Build:  docker build --target app -t zsp-app .   |   docker build --target ops -t zsp-ops .

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# No secrets are needed at build time (auth and DB clients are created lazily at runtime).
RUN npm run build

# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS app
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 app && useradd --system --uid 1001 --gid app app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]

# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS ops
WORKDIR /app
ENV NODE_ENV=production
# pg_dump/pg_restore must be >= the server's major version.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update && apt-get install -y --no-install-recommends postgresql-client-16 \
 && rm -rf /var/lib/apt/lists/*
RUN groupadd --system --gid 1001 ops && useradd --system --uid 1001 --gid ops --create-home ops
COPY --from=deps --chown=ops:ops /app/node_modules ./node_modules
COPY --chown=ops:ops package.json tsconfig.json ./
COPY --chown=ops:ops drizzle ./drizzle
COPY --chown=ops:ops scripts ./scripts
COPY --chown=ops:ops src ./src
USER ops
# e.g. docker run --env-file prod.env zsp-ops npm run school -- migrate-all
CMD ["npm", "run", "school", "--", "list"]
