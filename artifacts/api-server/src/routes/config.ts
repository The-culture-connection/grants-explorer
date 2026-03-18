import { Router, type IRouter } from "express";

const router: IRouter = Router();

/** Read Firebase client config from env (same names as Vite / Railway Shared Variables). */
function firebaseConfigFromEnv(): Record<string, string> {
  const get = (camel: string): string => {
    const snake = camel.replace(/([A-Z])/g, "_$1").toUpperCase().replace(/^_/, "");
    return (
      process.env[camel] ??
      process.env[`VITE_FIREBASE_${snake}`] ??
      process.env[`FIREBASE_${snake}`] ??
      ""
    ).trim();
  };
  return {
    apiKey: get("apiKey"),
    authDomain: get("authDomain"),
    projectId: get("projectId"),
    storageBucket: get("storageBucket"),
    messagingSenderId: get("messagingSenderId"),
    appId: get("appId"),
    measurementId: get("measurementId"),
  };
}

/**
 * Public config for the frontend (e.g. Firebase client config).
 * Used when build-time env is not available (e.g. Railway vars only at runtime).
 */
router.get("/config", (_req, res) => {
  res.json({ firebase: firebaseConfigFromEnv() });
});

export default router;
