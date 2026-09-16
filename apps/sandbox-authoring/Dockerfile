# The authoring sandbox image: source policy, TS7 and esbuild behind one
# unix socket. It turns untrusted sources into artifacts and never runs
# one. Same host-identical workspace shape as the runtime image (node only
# type-strips real paths outside node_modules), pruned to the compiler's
# closure; platform binaries (tsc, esbuild) resolve for linux at install.
# the exact node the repository's toolchain pins (mise.toml, CI), by digest
ARG NODE_IMAGE=node:24.20.0-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf
FROM ${NODE_IMAGE} AS builder
RUN corepack enable
WORKDIR /app
COPY . .
# --ignore-scripts on purpose: the repo root's prepare patches a dev-only
# toolchain that is not (and must not be) in this closure
RUN pnpm install --frozen-lockfile --ignore-scripts --prod --filter-prod @qualy/sandbox-authoring... \
 && node tools/quality/prune-image-tree.mjs \
      apps/sandbox-authoring \
      packages/core/formula \
      packages/core/formula-compiler \
      packages/core/sandbox-rpc \
      packages/core/value-schema

FROM ${NODE_IMAGE}
ARG QUALY_RELEASE=dev
ARG QUALY_REVISION=unknown
LABEL org.opencontainers.image.title="qualy-sandbox-authoring" \
      org.opencontainers.image.version="${QUALY_RELEASE}" \
      org.opencontainers.image.revision="${QUALY_REVISION}" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
COPY --from=builder /app /app
# the socket directory, owned by the runtime user so a fresh named volume
# mounted there (deploy/compose.yaml) takes that ownership on first mount
RUN mkdir -p /run/qualy-sandbox/authoring && chown node:node /run/qualy-sandbox/authoring
USER node
WORKDIR /app
ENV NODE_ENV=production
ENV QUALY_SANDBOX_AUTHORING_SOCKET=/run/qualy-sandbox/authoring/authoring.sock
CMD ["node", "apps/sandbox-authoring/src/main.ts"]
