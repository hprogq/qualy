# The authoring sandbox image: source policy, TS7 and esbuild behind one
# unix socket. It turns untrusted sources into artifacts and never runs
# one. Same host-identical workspace shape as the runtime image (node only
# type-strips real paths outside node_modules), pruned to the compiler's
# closure; platform binaries (tsc, esbuild) resolve for linux at install.
FROM node:24-alpine AS builder
RUN corepack enable
WORKDIR /app
COPY . .
# --ignore-scripts on purpose: the repo root's prepare patches a dev-only
# toolchain that is not (and must not be) in this closure
RUN pnpm install --frozen-lockfile --ignore-scripts --prod --filter @qualy/sandbox-authoring... \
 && node tools/quality/prune-image-tree.mjs \
      apps/sandbox-authoring \
      packages/core/formula \
      packages/core/formula-compiler \
      packages/core/sandbox-rpc \
      packages/core/value-schema

FROM node:24-alpine
COPY --from=builder /app /app
USER node
WORKDIR /app
ENV NODE_ENV=production
ENV QUALY_SANDBOX_AUTHORING_SOCKET=/run/qualy-sandbox/authoring/authoring.sock
CMD ["node", "apps/sandbox-authoring/src/main.ts"]
