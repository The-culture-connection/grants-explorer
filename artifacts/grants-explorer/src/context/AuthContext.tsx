import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  type User as FirebaseUser,
} from "firebase/auth";
import {
  doc, getDoc, setDoc, updateDoc,
  collection, query, where, getDocs,
  serverTimestamp,
} from "firebase/firestore";
import { auth, db, ensureFirebaseConfig, isFirebaseConfigured } from "@/lib/firebase";
import { trackUserCreated } from "@/lib/events";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OrgProfileData {
  id: string;
  name: string;
  org_type: string;
  mission: string;
  program_areas: string[];
  population_served: string[];
  geography: string[];
  annual_budget: number;
  years_in_operation: number;
  has_501c3: boolean;
  is_small_business: boolean;
  keywords: string[];
}

export type UserRole = "admin" | "user";

export interface AuthUser {
  id: string;                      // Firebase UID
  email: string;
  org_profile: OrgProfileData | null;
  is_admin: boolean;
  role: UserRole;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (profile: OrgProfileData) => Promise<void>;
  addAdmin: (email: string) => Promise<void>;
}

// ─── Admin email list ─────────────────────────────────────────────────────────
const ADMIN_EMAILS = new Set(["admin@gmail.com"]);
function isAdminEmail(email: string | null) { return !!email && ADMIN_EMAILS.has(email.toLowerCase()); }

// ─── Firestore helpers ────────────────────────────────────────────────────────
async function loadOrCreateUser(firebaseUser: FirebaseUser): Promise<AuthUser> {
  const ref  = doc(db, "users", firebaseUser.uid);
  const snap = await getDoc(ref);
  const email = firebaseUser.email ?? "";
  const adminFlag = isAdminEmail(email);

  if (!snap.exists()) {
    const data = {
      email,
      org_profile: null,
      is_admin: adminFlag,
      role: adminFlag ? "admin" : "user",
      created_at: serverTimestamp(),
    };
    await setDoc(ref, data);
    // Fire webhook — new user registered for the first time
    trackUserCreated(firebaseUser.uid, email);
    return { id: firebaseUser.uid, email, org_profile: null, is_admin: adminFlag, role: adminFlag ? "admin" : "user" };
  }

  const data = snap.data();

  // Promote to admin if email matches — handle legacy documents
  if (adminFlag && !data.is_admin) {
    await updateDoc(ref, { is_admin: true, role: "admin" });
  }

  const role: UserRole = adminFlag || data.is_admin ? "admin" : "user";
  return {
    id: firebaseUser.uid,
    email,
    org_profile: data.org_profile ?? null,
    is_admin: adminFlag || !!data.is_admin,
    role,
  };
}

// ─── Context ──────────────────────────────────────────────────────────────────
const AuthContext = createContext<AuthContextValue | null>(null);

const AUTH_NOT_CONFIGURED_MSG =
  "Auth is not configured. Add Firebase env vars (apiKey, authDomain, projectId, etc.) to .env or Railway Variables to enable sign-in.";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;

    (async () => {
      await ensureFirebaseConfig();
      if (cancelled) return;
      const isConfigured = isFirebaseConfigured();
      setConfigured(isConfigured);
      if (!isConfigured) {
        setLoading(false);
        return;
      }
      if (typeof auth?.onAuthStateChanged !== "function") {
        setLoading(false);
        return;
      }
      let initialLoadDone = false;
      const timeout = window.setTimeout(() => {
        if (!initialLoadDone) {
          initialLoadDone = true;
          setLoading(false);
        }
      }, 3000);
      unsub = onAuthStateChanged(auth, async (firebaseUser) => {
        if (firebaseUser) {
          try {
            const authUser = await loadOrCreateUser(firebaseUser);
            if (!cancelled) setUser(authUser);
          } catch {
            if (!cancelled) setUser(null);
          }
        } else {
          if (!cancelled) setUser(null);
        }
        if (!initialLoadDone) {
          initialLoadDone = true;
          window.clearTimeout(timeout);
        }
        if (!cancelled) setLoading(false);
      });
    })();

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    if (!configured) throw new Error(AUTH_NOT_CONFIGURED_MSG);
    await signInWithEmailAndPassword(auth, email, password);
  }, [configured]);

  const signup = useCallback(async (email: string, password: string) => {
    if (!configured) throw new Error(AUTH_NOT_CONFIGURED_MSG);
    await createUserWithEmailAndPassword(auth, email, password);
  }, [configured]);

  const logout = useCallback(async () => {
    if (!configured) {
      setUser(null);
      return;
    }
    await signOut(auth);
    setUser(null);
  }, [configured]);

  const updateProfile = useCallback(
    async (profile: OrgProfileData) => {
      if (!configured) throw new Error("Auth is not configured.");
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) throw new Error("Not authenticated");
      const ref = doc(db, "users", firebaseUser.uid);
      await updateDoc(ref, { org_profile: profile });
      setUser((u) => (u ? { ...u, org_profile: profile } : u));
    },
    [configured],
  );

  const addAdmin = useCallback(
    async (email: string) => {
      if (!configured) throw new Error("Auth is not configured.");
      const normalized = email.toLowerCase().trim();
      const q = query(collection(db, "users"), where("email", "==", normalized));
      const snap = await getDocs(q);
      if (snap.empty) throw new Error("No account found with that email address");
      const targetDoc = snap.docs[0];
      if (targetDoc.data().is_admin) throw new Error("That user is already an admin");
      await updateDoc(targetDoc.ref, { is_admin: true, role: "admin" });
    },
    [configured],
  );

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, updateProfile, addAdmin }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
