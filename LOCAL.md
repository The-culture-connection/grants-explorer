# Running the webapp locally (without Replit)

This project runs fully on your machine. No Replit infrastructure is required.

## Prerequisites

- **Node.js** 18+ (project uses Node 24 on Replit; 18+ is fine locally)
- **pnpm** — install with `npm install -g pnpm`
- **PostgreSQL** — for the API server (auth and indexing). If you don’t have a DB yet, you can still run the app; grant search and the algorithm will work, but signup/login and the indexing tool will fail until `DATABASE_URL` is set.

## One-time setup

1. **Clone and install**
   ```bash
   cd "c:\Users\grace\The Culture Connection Tech Solutions\Grant-Explorer"
   pnpm install
   ```

2. **Environment**
   - Copy `.env.example` to `.env` in the repo root.
   - Set at least `DATABASE_URL` to your PostgreSQL connection string (e.g. `postgresql://user:password@localhost:5432/grants_explorer`).
   - Optional: set API keys (`SIMPLER_GRANTS_API_KEY`, `SAM_GOV_API_KEY`, etc.) and Firebase vars if you use those features.

## Run locally

From the repo root:

```bash
pnpm run dev
```

This starts:

- **API server** on **http://localhost:5000** (Express; uses `PORT` from `.env` or default 5000).
- **Vite dev server** on **http://localhost:3000** (React frontend). It proxies `/api` to the API server.

Open **http://localhost:3000** in your browser. The app talks to the API via the proxy, so no Replit or cloud backend is needed.

### Run API and frontend separately

- Terminal 1 — API only:
  ```bash
  pnpm run dev:api
  ```
- Terminal 2 — Frontend only:
  ```bash
  pnpm run dev:web
  ```

Frontend still proxies `/api` to port 5000 by default. To use a different API port, set `VITE_API_PORT` (e.g. `VITE_API_PORT=4000 pnpm run dev:web`).

## Production-style run (single process)

Build and run the API server; it serves the built frontend and the API:

```bash
pnpm run build
PORT=5000 NODE_ENV=production node artifacts/api-server/dist/index.cjs
```

Then open **http://localhost:5000**. Set `PORT` in `.env` or in the environment if you want another port.

## Notes

- **Replit plugins** (cartographer, dev banner, runtime error overlay) are only loaded when `REPL_ID` is set, so they are not used when running locally.
- **Windows**: The root `preinstall` and API `dev` script are set up to work on Windows (Node-based preinstall, `cross-env` for `NODE_ENV`).
- **Database**: Run Drizzle migrations as needed (see `lib/db` and your existing migration workflow). The app expects the schema to exist when using auth or indexing.
