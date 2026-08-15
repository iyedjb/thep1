# ---- Base ----
FROM node:22-slim AS base

ENV PUPPETEER_SKIP_DOWNLOAD=true

RUN npm install -g pnpm@11

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

# Install Chromium and support fonts for Puppeteer PDF/screenshot rendering
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-kacst \
    fonts-freefont-ttf \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@11

WORKDIR /app

# Copy the full built workspace
COPY --from=builder /app /app

EXPOSE 3001

ENV NODE_ENV=production
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true

CMD ["pnpm", "start"]
