# ---- Base ----
FROM node:22-slim AS base

RUN npm install -g pnpm@9

WORKDIR /app

# ---- Dependencies ----
FROM base AS deps

# Copy workspace config files (for better layer caching)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./

# Copy all workspace package.json files
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/db/package.json ./lib/db/
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/ads-intelligence/package.json ./artifacts/ads-intelligence/
COPY artifacts/mockup-sandbox/package.json ./artifacts/mockup-sandbox/
COPY scripts/package.json ./scripts/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# ---- Builder ----
FROM deps AS builder

# Copy all source files
COPY . .

# Run the workspace build
RUN pnpm run build

# ---- Runner ----
FROM node:22-slim AS runner

RUN npm install -g pnpm@9

WORKDIR /app

# Copy the full built workspace
COPY --from=builder /app /app

EXPOSE 3001

ENV NODE_ENV=production

CMD ["pnpm", "start"]
