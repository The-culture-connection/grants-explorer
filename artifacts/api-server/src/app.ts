import express, { type Express } from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import router from "./routes";

const app: Express = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

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
