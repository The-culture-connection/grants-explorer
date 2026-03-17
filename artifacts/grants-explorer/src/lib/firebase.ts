import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

declare const __FIREBASE_CONFIG__: {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId: string;
};

const firebaseConfig = __FIREBASE_CONFIG__;
const hasConfig = !!firebaseConfig?.apiKey?.trim();

let app: FirebaseApp | null = null;
if (hasConfig && getApps().length === 0) {
  app = initializeApp(firebaseConfig);
}

const _app = app ?? getApps()[0] ?? null;
export const auth: Auth = _app ? getAuth(_app) : ({} as unknown as Auth);
export const db: Firestore = _app ? getFirestore(_app) : ({} as unknown as Firestore);
