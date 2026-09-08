# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* are inlined at build time, so they must be present here rather than only
# at runtime. Passed as build args by compose and CI.
ARG NEXT_PUBLIC_MEDUSA_URL
ARG NEXT_PUBLIC_MEDUSA_PK
ARG NEXT_PUBLIC_REGION_ID
ARG NEXT_PUBLIC_STRIPE_PK
ENV NEXT_PUBLIC_MEDUSA_URL=$NEXT_PUBLIC_MEDUSA_URL \
    NEXT_PUBLIC_MEDUSA_PK=$NEXT_PUBLIC_MEDUSA_PK \
    NEXT_PUBLIC_REGION_ID=$NEXT_PUBLIC_REGION_ID \
    NEXT_PUBLIC_STRIPE_PK=$NEXT_PUBLIC_STRIPE_PK
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /bin/false next
COPY --from=build --chown=next:next /app/.next ./.next
COPY --from=build --chown=next:next /app/public ./public
COPY --from=build --chown=next:next /app/node_modules ./node_modules
COPY --from=build --chown=next:next /app/package*.json ./
COPY --from=build --chown=next:next /app/next.config.ts ./
USER next
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://localhost:3000/ || exit 1
CMD ["npm", "run", "start"]
