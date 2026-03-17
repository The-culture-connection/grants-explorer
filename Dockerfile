FROM node:24-slim

# Install pnpm matching the version used to generate the lockfile
RUN npm install -g pnpm@10.26.1

WORKDIR /app

# Copy all workspace files
COPY . .

# Install dependencies — bypass frozen-lockfile since pnpm-workspace.yaml
# has platform-scoped overrides that only partially appear in the lockfile
RUN pnpm install --no-frozen-lockfile

# Build: Vite frontend (BASE_PATH=/ for root-domain Railway deployment)
# then bundle the Express API server with esbuild
ENV BASE_PATH=/
RUN pnpm run railway:build

# Railway injects PORT at runtime; the Express server reads it
EXPOSE 3000
CMD ["node", "artifacts/api-server/dist/index.cjs"]
