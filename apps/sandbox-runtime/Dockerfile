# The runtime sandbox image: the quickjs engine behind one unix socket.
# The layout inside is the same pnpm workspace shape the host runs - real
# package sources under /app/packages, node_modules symlinks pointing at
# them - because node only type-strips sources whose REAL path is outside
# node_modules. The tree is pruned to the runtime's closure; nothing else
# from the repository rides along.
FROM node:24-alpine AS builder
RUN corepack enable
WORKDIR /app
COPY . .
# --ignore-scripts on purpose: the repo root's prepare patches a dev-only
# toolchain that is not (and must not be) in this closure
RUN pnpm install --frozen-lockfile --ignore-scripts --prod --filter @qualy/sandbox-runtime... \
 && node tools/quality/prune-image-tree.mjs \
      apps/sandbox-runtime \
      packages/core/sandbox-engine \
      packages/core/sandbox-rpc

FROM node:24-alpine
COPY --from=builder /app /app
USER node
WORKDIR /app
ENV NODE_ENV=production
ENV QUALY_SANDBOX_RUNTIME_SOCKET=/run/qualy-sandbox/runtime/runtime.sock
CMD ["node", "apps/sandbox-runtime/src/main.ts"]
