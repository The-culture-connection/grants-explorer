import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth as getFirebaseAuth, type Auth } from "firebase/auth";
import { getFirestore as getFirebaseFirestore, type Firestore } from "firebase/firestore";

declare const __FIREBASE_CONFIG__: {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId: string;
};

const buildTimeConfig = typeof __FIREBASE_CONFIG__ !== "undefined" ? __FIREBASE_CONFIG__ : null;
const hasBuildTimeConfig = !!buildTimeConfig?.apiKey?.trim();

let app: FirebaseApp | null = null;
let authInstance: Auth = {} as unknown as Auth;
let dbInstance: Firestore = {} as unknown as Firestore;

if (hasBuildTimeConfig && getApps().length === 0) {
  app = initializeApp(buildTimeConfig!);
  authInstance = getFirebaseAuth(app);
  dbInstance = getFirebaseFirestore(app);
} else if (getApps().length > 0) {
  app = getApp();
  authInstance = getFirebaseAuth(app);
  dbInstance = getFirebaseFirestore(app);
}

/** Mutable so we can set after async init from /api/config (e.g. on Railway where env is runtime-only). */
export let auth: Auth = authInstance;
export let db: Firestore = dbInstance;

/** True if Firebase was initialized (at build time or after ensureFirebaseConfig). */
export function isFirebaseConfigured(): boolean {
  return typeof auth?.onAuthStateChanged === "function";
}

/**
 * If build-time config is missing (e.g. production with Railway Shared Variables only at runtime),
 * fetch config from GET /api/config and initialize Firebase. Resolves to true if config is available.
 */
export async function ensureFirebaseConfig(): Promise<boolean> {
  if (isFirebaseConfigured()) return true;
  const urlsToTry = [
    "/api/config",
    `${(import.meta.env.BASE_URL ?? "/").replace(/\/$/, "")}/api/config`,
    new URL("/api/config", window.location.origin).href,
  ].filter((u, i, a) => a.indexOf(u) === i);

  for (const url of urlsToTry) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      const config = data?.firebase;
      if (!config?.apiKey?.trim()) continue;
      if (getApps().length > 0) {
        app = getApp();
        auth = getFirebaseAuth(app);
        db = getFirebaseFirestore(app);
        return true;
      }
      app = initializeApp(config);
      auth = getFirebaseAuth(app);
      db = getFirebaseFirestore(app);
      return true;
    } catch {
      // try next URL
    }
  }
  return false;
}
