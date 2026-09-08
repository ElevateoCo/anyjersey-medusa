# syntax=docker/dockerfile:1

# Medusa supports Node 20/22 LTS only. Pinned here rather than left to whatever the host
# has — the dev machine runs Node 26, which Medusa refuses.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# sharp needs no build toolchain on this base, but keep the layer explicit so a future
# native dep fails loudly at build rather than at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .

# Whether to build the admin dashboard into the image.
#
# Measured, not guessed: the admin bundle is a Vite/rollup build and it is OOM-killed
# (exit 137) in a 3.8 GB builder, immediately after "Compiling frontend source". Capping
# V8's heap does not help — most of rollup's footprint is native, so the JS heap limit is
# the wrong lever. It needs roughly 6 GB.
#
#   BUILD_ADMIN=true   (default) full image; needs a ~6 GB builder. This is what CI builds
#                      and what ships, because the admin dashboard is the point of §15.
#   BUILD_ADMIN=false  server-only image; builds on a laptop with Docker Desktop defaults.
#                      The API, the storefront and every custom route are identical; only
#                      the dashboard is absent, and it can be served separately from
#                      `medusa build --admin-only`.
#
# The alternative — silently dropping the admin so the build always passes — would mean
# discovering at deploy time that the dashboard is missing.
ARG BUILD_ADMIN=true
# V8 sizes its default old-space from the host's memory rather than the cgroup limit, so
# naming it keeps the server compile inside the ceiling even on a small builder.
ENV NODE_OPTIONS=--max-old-space-size=2560
RUN ADMIN_DISABLED=$([ "$BUILD_ADMIN" = "true" ] && echo false || echo true) npx medusa build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
# `medusa build` emits a *self-contained application* at .medusa/server — its own
# package.json, its own compiled medusa-config.js, its own src. It is not a dist folder
# beside the source, and `medusa start` has to run from inside it.
#
# The first version copied .medusa alongside the source and ran from /app, which failed at
# boot with "Cannot find module '/app/medusa-config'": the TypeScript config is not loadable
# in production, and the compiled one lives one level down. So the working directory *is*
# the build output.
WORKDIR /app/.medusa/server
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /bin/false medusa
COPY --from=build --chown=medusa:medusa /app/.medusa/server ./
# Production deps are installed against the build output's own package.json rather than
# copied from the deps stage: the generated manifest is not identical to the source one, and
# installing the wrong tree is how a module resolves in the builder and not at runtime.
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
USER medusa
EXPOSE 9000

# The app refuses to boot in production without the keys marked critical in
# src/integrations.ts. That is deliberate: a silently disabled integration is worse than a
# container that will not start, and this is where that shows up.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://localhost:9000/health || exit 1

CMD ["npm", "run", "start"]
