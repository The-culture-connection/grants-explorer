import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// PORT is only required for the dev server, not for `vite build`.
// Default to 3000 so builds succeed in CI/Railway without a PORT env var.
const port = Number(process.env.PORT || "3000");

// BASE_PATH defaults to "/" for production (Railway serves at the domain root).
// Replit overrides this via its own env var to handle path-based routing.
const basePath = process.env.BASE_PATH || "/";

export default defineConfig({
  base: basePath,
  define: {
    __FIREBASE_CONFIG__: JSON.stringify({
      apiKey:            process.env.apiKey            ?? "",
      authDomain:        process.env.authDomain        ?? "",
      projectId:         process.env.projectId         ?? "",
      storageBucket:     process.env.storageBucket     ?? "",
      messagingSenderId: process.env.messagingSenderId ?? "",
      appId:             process.env.appId             ?? "",
      measurementId:     process.env.measurementId     ?? "",
    }),
  },
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
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
