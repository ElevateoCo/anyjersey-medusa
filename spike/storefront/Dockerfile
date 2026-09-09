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
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_ALLOW_INDEXING
ARG NEXT_PUBLIC_LEGAL_NAME
ARG NEXT_PUBLIC_LEGAL_ADDRESS
ARG NEXT_PUBLIC_SUPPORT_EMAIL
ARG NEXT_PUBLIC_SUPPORT_PHONE
ARG NEXT_PUBLIC_PRIVACY_EMAIL
ARG NEXT_PUBLIC_EU_REPRESENTATIVE
ARG NEXT_PUBLIC_GPSR_RESPONSIBLE_PERSON
ARG NEXT_PUBLIC_IOSS_NUMBER
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_HOST
ENV NEXT_PUBLIC_MEDUSA_URL=$NEXT_PUBLIC_MEDUSA_URL \
    NEXT_PUBLIC_MEDUSA_PK=$NEXT_PUBLIC_MEDUSA_PK \
    NEXT_PUBLIC_REGION_ID=$NEXT_PUBLIC_REGION_ID \
    NEXT_PUBLIC_STRIPE_PK=$NEXT_PUBLIC_STRIPE_PK \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_ALLOW_INDEXING=$NEXT_PUBLIC_ALLOW_INDEXING \
    NEXT_PUBLIC_LEGAL_NAME=$NEXT_PUBLIC_LEGAL_NAME \
    NEXT_PUBLIC_LEGAL_ADDRESS=$NEXT_PUBLIC_LEGAL_ADDRESS \
    NEXT_PUBLIC_SUPPORT_EMAIL=$NEXT_PUBLIC_SUPPORT_EMAIL \
    NEXT_PUBLIC_SUPPORT_PHONE=$NEXT_PUBLIC_SUPPORT_PHONE \
    NEXT_PUBLIC_PRIVACY_EMAIL=$NEXT_PUBLIC_PRIVACY_EMAIL \
    NEXT_PUBLIC_EU_REPRESENTATIVE=$NEXT_PUBLIC_EU_REPRESENTATIVE \
    NEXT_PUBLIC_GPSR_RESPONSIBLE_PERSON=$NEXT_PUBLIC_GPSR_RESPONSIBLE_PERSON \
    NEXT_PUBLIC_IOSS_NUMBER=$NEXT_PUBLIC_IOSS_NUMBER \
    NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY \
    NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST
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
