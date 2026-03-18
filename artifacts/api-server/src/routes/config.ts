import { Router, type IRouter } from "express";

const router: IRouter = Router();

/** All env key variants we try (Railway / Vite / .env naming). Railway often uses UPPER_SNAKE_CASE. */
function envKeys(camel: string): string[] {
  const snake = camel.replace(/([A-Z])/g, "_$1").toUpperCase().replace(/^_/, "");
  const noUnderscore = snake.replace(/_/g, "");
  return [
    camel,
    snake,
    noUnderscore,
    `FIREBASE_${snake}`,
    `FIREBASE_${noUnderscore}`,
    `VITE_FIREBASE_${snake}`,
  ];
}

function firebaseConfigFromEnv(): Record<string, string> {
  const keys = [
    "apiKey",
    "authDomain",
    "projectId",
    "storageBucket",
    "messagingSenderId",
    "appId",
    "measurementId",
  ] as const;
  const out: Record<string, string> = {};
  for (const camel of keys) {
    let val = "";
    for (const k of envKeys(camel)) {
      const v = process.env[k];
      if (v != null && String(v).trim()) {
        val = String(v).trim();
        break;
      }
    }
    out[camel] = val;
  }
  return out;
}

/**
 * Public config for the frontend (Firebase client config from env).
 * Used when build-time env is not available (e.g. Railway Shared Variables at runtime).
 */
router.get("/config", (_req, res) => {
  const firebase = firebaseConfigFromEnv();
  const hasApiKey = !!firebase.apiKey?.trim();
  if (!hasApiKey) {
    console.warn(
      "[config] GET /api/config: firebase.apiKey is empty. Set Railway Variables: apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId, measurementId (or FIREBASE_API_KEY, etc.)",
    );
  }
  res.json({ firebase });
});

/**
 * Debug: which Firebase keys the server sees (values hidden). Hit /api/config/check in the browser.
 */
router.get("/config/check", (_req, res) => {
  const firebase = firebaseConfigFromEnv();
  const keys = [
    "apiKey",
    "authDomain",
    "projectId",
    "storageBucket",
    "messagingSenderId",
    "appId",
    "measurementId",
  ] as const;
  const present: Record<string, boolean> = {};
  for (const k of keys) present[k] = !!firebase[k]?.trim();
  res.json({ firebaseKeysPresent: present, allPresent: keys.every((k) => present[k]) });
});

export default router;
