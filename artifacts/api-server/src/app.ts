import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import router from "./routes";

const app: Express = express();

// Healthcheck first so Railway can reach it before any other middleware or router setup
app.get("/api/healthz", (_req, res) => {
  try {
    res.setHeader("Content-Type", "application/json");
    res.status(200).end(JSON.stringify({ status: "ok" }));
  } catch {
    if (!res.headersSent) res.status(200).end(JSON.stringify({ status: "ok" }));
  }
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Custom error handler so we never dump the whole minified bundle to logs
const STACK_MAX = 1500;
app.use((err: unknown, _req: Request, res: Response, _next: () => void) => {
  const msg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error && err.stack ? err.stack : "";
  console.error("[express error]", msg);
  if (stack) console.error(stack.length <= STACK_MAX ? stack : stack.slice(0, STACK_MAX) + "\n... (truncated)");
  if (!res.headersSent) {
    res.status(500).setHeader("Content-Type", "application/json").end(JSON.stringify({ error: "Internal Server Error" }));
  }
});

// ── Production static file serving ───────────────────────────────────────────
// When deployed to Railway the Express server owns the whole domain, so it
// serves the pre-built Vite frontend as static files.  In development Vite's
// own dev server handles this instead.
if (process.env.NODE_ENV === "production") {
  // Resolve relative to the repo root (Railway's CWD when it starts the process)
  const staticDir = path.resolve(
    process.cwd(),
    "artifacts/grants-explorer/dist/public",
  );

  if (fs.existsSync(staticDir)) {
    app.use(express.static(staticDir));

    // SPA catch-all: return index.html for any route that isn't an API call
    // so that client-side routing (Wouter) works on direct URL loads.
    app.get("*", (_req, res) => {
      res.sendFile(path.join(staticDir, "index.html"));
    });
  } else {
    console.warn(
      "[app] Static dir not found at",
      staticDir,
      "— frontend will not be served. Run `pnpm --filter @workspace/grants-explorer run build` first.",
    );
  }
}

export default app;
