# The runtime sandbox image: the quickjs engine behind one unix socket.
# The layout inside is the same pnpm workspace shape the host runs - real
# package sources under /app/packages, node_modules symlinks pointing at
# them - because node only type-strips sources whose REAL path is outside
# node_modules. The tree is pruned to the runtime's closure; nothing else
# from the repository rides along.
# the exact node the repository's toolchain pins (mise.toml, CI), by digest
ARG NODE_IMAGE=node:24.20.0-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf
FROM ${NODE_IMAGE} AS builder
RUN corepack enable
WORKDIR /app
COPY . .
# --ignore-scripts on purpose: the repo root's prepare patches a dev-only
# toolchain that is not (and must not be) in this closure
RUN pnpm install --frozen-lockfile --ignore-scripts --prod --filter-prod @qualy/sandbox-runtime... \
 && node tools/quality/prune-image-tree.mjs \
      apps/sandbox-runtime \
      packages/core/sandbox-engine \
      packages/core/sandbox-rpc

FROM ${NODE_IMAGE}
ARG QUALY_RELEASE=dev
ARG QUALY_REVISION=unknown
LABEL org.opencontainers.image.title="qualy-sandbox-runtime" \
      org.opencontainers.image.version="${QUALY_RELEASE}" \
      org.opencontainers.image.revision="${QUALY_REVISION}" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
COPY --from=builder /app /app
# the socket directory, owned by the runtime user so a fresh named volume
# mounted there (deploy/compose.yaml) takes that ownership on first mount
RUN mkdir -p /run/qualy-sandbox/runtime && chown node:node /run/qualy-sandbox/runtime
USER node
WORKDIR /app
ENV NODE_ENV=production
ENV QUALY_SANDBOX_RUNTIME_SOCKET=/run/qualy-sandbox/runtime/runtime.sock
CMD ["node", "apps/sandbox-runtime/src/main.ts"]
