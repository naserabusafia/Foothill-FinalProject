# syntax=docker/dockerfile:1

# ---- Build: compile TypeScript to dist/ ------------------------------------
FROM node:24-alpine AS build
WORKDIR /app

# Dependencies first: this layer is reused until package*.json changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- Runtime: production dependencies + compiled code only -----------------
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
# SQL migrations, applied on start (RUN_MIGRATIONS_ON_START).
COPY drizzle ./drizzle

# The official image ships an unprivileged "node" user.
USER node
EXPOSE 3000

HEALTHCHECK --interval=5s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/server.js"]
