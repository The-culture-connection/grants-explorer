import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import fs from "fs";

// Repo root: .env lives here for local dev (shared with api-server).
const repoRoot = path.resolve(import.meta.dirname, "..", "..");

/** Load .env from repo root; fallback to loadEnv for compatibility. */
function loadRepoEnv(): Record<string, string> {
  const fromLoadEnv = loadEnv(process.env.MODE ?? "development", repoRoot, "");
  const envPath = path.join(repoRoot, ".env");
  if (!fs.existsSync(envPath)) return fromLoadEnv;
  const raw = fs.readFileSync(envPath, "utf-8");
  const parsed: Record<string, string> = { ...fromLoadEnv };
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    parsed[key] = val;
  }
  return parsed;
}
const env = loadRepoEnv();

// Optional Replit-only plugins (only load when running inside Replit)
const replitPlugins =
  process.env.NODE_ENV !== "production" && process.env.REPL_ID !== undefined
    ? [
        await import("@replit/vite-plugin-runtime-error-modal").then((m) => m.default()),
        await import("@replit/vite-plugin-cartographer").then((m) =>
          m.cartographer({ root: path.resolve(import.meta.dirname, "..") }),
        ),
        await import("@replit/vite-plugin-dev-banner").then((m) => m.devBanner()),
      ]
    : [];

// PORT is only required for the dev server, not for `vite build`.
// Default to 3000 so builds succeed in CI/Railway without a PORT env var.
const port = Number(process.env.PORT || env.PORT || "3000");

// Local dev: proxy /api to the backend (default 5000). Set VITE_API_PORT to override.
const apiPort = process.env.VITE_API_PORT ?? env.VITE_API_PORT ?? "5000";

// BASE_PATH defaults to "/" for production (Railway serves at the domain root).
// Replit overrides this via its own env var to handle path-based routing.
const basePath = process.env.BASE_PATH ?? env.BASE_PATH ?? "/";

// Firebase: read from .env or Railway env. Supports apiKey, authDomain, etc. or VITE_FIREBASE_* / FIREBASE_*
function firebaseEnv(key: string): string {
  const camel = key;
  const snake = key.replace(/([A-Z])/g, "_$1").toUpperCase().replace(/^_/, "");
  const variants = [
    env[camel],
    process.env[camel],
    env[`VITE_FIREBASE_${snake}`],
    process.env[`VITE_FIREBASE_${snake}`],
    env[`FIREBASE_${snake}`],
    process.env[`FIREBASE_${snake}`],
  ];
  for (const v of variants) if (v != null && String(v).trim()) return String(v).trim();
  return "";
}

export default defineConfig({
  base: basePath,
  define: {
    __FIREBASE_CONFIG__: JSON.stringify({
      apiKey: firebaseEnv("apiKey"),
      authDomain: firebaseEnv("authDomain"),
      projectId: firebaseEnv("projectId"),
      storageBucket: firebaseEnv("storageBucket"),
      messagingSenderId: firebaseEnv("messagingSenderId"),
      appId: firebaseEnv("appId"),
      measurementId: firebaseEnv("measurementId"),
    }),
  },
  plugins: [react(), tailwindcss(), ...replitPlugins],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
      },
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
