# Pin the multi-platform manifest so API and future worker images share a runtime.
FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS base
WORKDIR /app

# CPU binaries are bundled by ORT; its Linux installer otherwise downloads CUDA.
# No browser binaries or local inference models are needed by the service profile.
ENV ONNXRUNTIME_NODE_INSTALL=skip \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/navigation-core/package.json ./packages/navigation-core/package.json
COPY packages/nlp/package.json ./packages/nlp/package.json
COPY packages/vision/package.json ./packages/vision/package.json
COPY packages/ui/package.json ./packages/ui/package.json

FROM base AS build
RUN npm ci --no-audit --no-fund
COPY apps/api/src/ ./apps/api/src/
COPY packages/ ./packages/
COPY scripts/build-api.mjs ./scripts/build-api.mjs
COPY scripts/artifact-files.mjs ./scripts/artifact-files.mjs
RUN npm run build:api

FROM base AS production-dependencies
RUN npm ci --omit=dev --workspace=apps/api --include-workspace-root=false --no-audit --no-fund

# Real PostgreSQL checks use a disposable image, never the published runtime.
FROM build AS postgres-tests
COPY tests/integration/postgres/ ./tests/integration/postgres/
COPY tests/support/saved-data-fixture.ts ./tests/support/saved-data-fixture.ts
COPY tests/support/navigation-model-fixture.ts ./tests/support/navigation-model-fixture.ts
RUN ./node_modules/.bin/esbuild tests/integration/postgres/run.ts --bundle --platform=node --target=node24 --format=esm --packages=external --outfile=/app/postgres-check.mjs
USER node
CMD ["node", "/app/postgres-check.mjs"]

FROM base AS runtime
ENV NODE_ENV=production \
    THOLI_SERVICE_HOST=0.0.0.0
# Apply the distro's available security fixes, then remove build/package-manager
# tooling from the runtime. The release records and reuses this exact image;
# rebuilding against a later security repository produces new reviewable bytes.
RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* /usr/local/lib/node_modules/npm /opt/yarn-* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --from=production-dependencies /app/node_modules/ ./node_modules/
COPY --from=build /app/apps/api/dist/ ./apps/api/dist/
COPY LICENSE ./LICENSE
USER node
EXPOSE 8788
CMD ["node", "apps/api/dist/service.js"]
