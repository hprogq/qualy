# syntax=docker/dockerfile:1

# The Qualy server release: one immutable image, built from this repository
# and nothing else.
#
# Its inputs are the checkout - package.json, pnpm-lock.yaml, qualy.yml, the
# committed qualy.lock.json, the committed db/migrations and the sources. It
# reads no deployment's state, generates no migration, rewrites no lock, and
# comes out the same whatever instance it is later deployed to. The same
# image serves (its default command) and deploys (`node apps/cli/src/main.ts
# deploy`, run once per release against the instance's database).
#
# Three stages. `web` installs everything, checks the lock describes this
# tree, and builds the browser application into the web plugin's release
# store. `runtime` installs only the production dependencies of what runs -
# the application's plugins (the root package), the server host and the
# deploy CLI - and prunes the tree to that closure. The final stage is that
# tree plus the staged web release, on a clean base, as an unprivileged user.
#
# The server-side code ships as the TypeScript node runs directly (the
# repository has no emit step: node strips types at load, as `pnpm start`
# does), so the workspace packages stay real directories with node_modules
# symlinks pointing at them - node only type-strips sources whose real path
# is outside node_modules. Tests, the browser halves' sources and the dev
# toolchain are pruned; the browser is served from its built bundle.
#
# glibc rather than alpine: argon2 ships prebuilt binaries for linux-x64 and
# linux-arm64 (glibc), which is what lets the install run with scripts off.

ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS source
RUN corepack enable
WORKDIR /app
COPY . .

# --- the browser application, built and staged --------------------------------
FROM source AS web
# --ignore-scripts on purpose: the repo root's prepare patches a dev-only
# toolchain (the Effect language service into tsc) that a build has no use for
RUN pnpm install --frozen-lockfile --ignore-scripts
# the lock must describe this tree before anything is built from it; frozen
# writes nothing, and a stale lock is a build failure rather than a repair
RUN node apps/cli/src/main.ts resolve --frozen-lockfile \
 && pnpm --filter @qualy/web-app build \
 && node packages/build/web/src/stage.ts \
 && node tools/quality/check-staged-web.ts

# --- the runtime tree: production dependencies of what runs, pruned ------------
FROM source AS runtime
# --filter-prod, not --filter: the closure is followed along production edges
# only, so a package that a plugin needs just for its tests stays out along
# with everything it would have brought
RUN pnpm install --frozen-lockfile --ignore-scripts --prod \
      --filter-prod 'qualy...' --filter-prod '@qualy/app...' --filter-prod '@qualy/cli...' \
 && node tools/release/prune-server-image.mjs
COPY --from=web /app/packages/plugins/infra/web/client-dist /app/packages/plugins/infra/web/client-dist

# --- the image ------------------------------------------------------------------
FROM ${NODE_IMAGE}
ARG QUALY_RELEASE=dev
LABEL org.opencontainers.image.title="qualy-server" \
      org.opencontainers.image.version="${QUALY_RELEASE}" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
COPY --from=runtime --chown=node:node /app /app
# The paths a deployment mounts (deploy/compose.yaml): the attachment store
# and the two sandbox socket directories. Created here and owned by the
# runtime user so that a fresh named volume takes that ownership on its
# first mount instead of arriving root-owned and unwritable.
RUN mkdir -p /var/lib/qualy/storage /run/qualy-sandbox/runtime /run/qualy-sandbox/authoring \
 && chown -R node:node /var/lib/qualy /run/qualy-sandbox
USER node
WORKDIR /app
ENV NODE_ENV=production
EXPOSE 3000
# liveness only: readiness is the orchestrator's question, asked at /health/ready
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT ?? 3000) + '/health/live').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/server/src/run.ts", "production"]
