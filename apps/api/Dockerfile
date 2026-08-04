# Multi-stage production image for API and worker
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl wget

FROM base AS deps
COPY package.json package-lock.json* ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
COPY prisma ./prisma
RUN npm install

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
COPY openapi ./openapi
RUN npx prisma generate --schema=prisma/schema.prisma \
  && npm run build -w @orderflow/shared \
  && npm run build -w @orderflow/api

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/openapi ./openapi
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]
