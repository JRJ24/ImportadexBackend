FROM node:20-alpine AS deps
WORKDIR /app

RUN npm install -g pnpm

COPY ImportadexBackend/package*.json ./
COPY ImportadexBackend/pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=PROD

RUN npm install -g pnpm

COPY --from=deps /app/node_modules ./node_modules
COPY ImportadexBackend ./
COPY MIREX-CLIENT ../MIREX-CLIENT

RUN pnpm run db:generate
RUN NODE_OPTIONS="--max-old-space-size=512" pnpm run build

EXPOSE 3000
CMD ["node", "dist/app/src/App.js"]
