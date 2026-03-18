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

## Railway: Firebase env vars

Firebase config is **baked in at build time** when Railway runs `pnpm run railway:build`. Add these in **Railway → your project → Variables** (shared or service) so the build sees them. Any of these naming styles work:

| Use in Railway (any of these) | Meaning |
|-------------------------------|--------|
| `apiKey` or `FIREBASE_API_KEY` or `VITE_FIREBASE_API_KEY` | Firebase API key |
| `authDomain` or `FIREBASE_AUTH_DOMAIN` | e.g. `your-app.firebaseapp.com` |
| `projectId` or `FIREBASE_PROJECT_ID` | Firebase project ID |
| `storageBucket` or `FIREBASE_STORAGE_BUCKET` | e.g. `your-app.firebasestorage.app` |
| `messagingSenderId` or `FIREBASE_MESSAGING_SENDER_ID` | Numeric sender ID |
| `appId` or `FIREBASE_APP_ID` | e.g. `1:123:web:abc` |
| `measurementId` or `FIREBASE_MEASUREMENT_ID` | e.g. `G-XXXXXXXXXX` (optional) |

Redeploy after adding or changing these so the frontend build runs again with the new values.

## Notes

- **Replit plugins** (cartographer, dev banner, runtime error overlay) are only loaded when `REPL_ID` is set, so they are not used when running locally.
- **Windows**: The root `preinstall` and API `dev` script are set up to work on Windows (Node-based preinstall, `cross-env` for `NODE_ENV`).
- **Database**: Run Drizzle migrations as needed (see `lib/db` and your existing migration workflow). The app expects the schema to exist when using auth or indexing.
