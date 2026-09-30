# The runtime sandbox image: the quickjs engine behind one unix socket.
# The layout inside is the same pnpm workspace shape the host runs - real
# package sources under /app/packages, node_modules symlinks pointing at
# them - because node only type-strips sources whose REAL path is outside
# node_modules. The tree is pruned to the runtime's closure; nothing else
# from the repository rides along.
# the exact node the repository's toolchain pins (mise.toml, CI), by digest
ARG NODE_IMAGE=node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
FROM ${NODE_IMAGE} AS builder
RUN corepack enable
WORKDIR /app
COPY . .
# --ignore-scripts on purpose: the repo root's prepare patches a dev-only
# toolchain that is not (and must not be) in this closure
RUN pnpm install --frozen-lockfile --ignore-scripts --prod --filter-prod @qualy/sandbox-runtime... \
 && node tools/quality/prune-image-tree.mjs @qualy/sandbox-runtime

FROM ${NODE_IMAGE}
ARG QUALY_RELEASE=dev
ARG QUALY_REVISION=unknown
LABEL org.opencontainers.image.title="qualy-sandbox-runtime" \
      org.opencontainers.image.version="${QUALY_RELEASE}" \
      org.opencontainers.image.revision="${QUALY_REVISION}" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
COPY --from=builder /app /app
# The package managers the base image ships (npm, npx, corepack, yarn) are
# for building, which happened in the stage before; nothing here runs them,
# and kept they are a second dependency tree the scanners report on.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-v* \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg
# the socket directory, owned by the runtime user so a fresh named volume
# mounted there (deploy/compose.yaml) takes that ownership on first mount
RUN mkdir -p /run/qualy-sandbox/runtime && chown node:node /run/qualy-sandbox/runtime
USER node
WORKDIR /app
ENV NODE_ENV=production
ENV QUALY_SANDBOX_RUNTIME_SOCKET=/run/qualy-sandbox/runtime/runtime.sock
CMD ["node", "apps/sandbox-runtime/src/main.ts"]
