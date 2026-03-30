FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
ARG NEXT_PUBLIC_GITHUB_APP_SLUG
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_GITHUB_APP_SLUG=tomo-bounty-pay-dev
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

COPY package*.json ./
RUN apk add --no-cache curl \
  && npm ci --omit=dev \
  && npm cache clean --force

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/next.config.js ./next.config.js

RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
USER nextjs

EXPOSE 3000
CMD ["npm", "run", "start"]
