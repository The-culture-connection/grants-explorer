FROM node:24-slim

# Install pnpm matching the version used to generate the lockfile
RUN npm install -g pnpm@10.26.1

WORKDIR /app

# Copy all workspace files (.dockerignore excludes node_modules, dist, .git)
COPY . .

# Install dependencies — bypass frozen-lockfile since pnpm-workspace.yaml
# has platform-scoped overrides that only partially appear in the lockfile
RUN pnpm install --no-frozen-lockfile --shamefully-hoist

# Build the Vite frontend (BASE_PATH=/ for root-domain Railway deployment)
ENV BASE_PATH=/
RUN pnpm --filter @workspace/grants-explorer run build

# Bundle the Express API server with esbuild
RUN pnpm --filter @workspace/api-server run build

# Railway injects PORT at runtime; the Express server reads it
EXPOSE 3000
CMD ["node", "artifacts/api-server/dist/index.cjs"]
