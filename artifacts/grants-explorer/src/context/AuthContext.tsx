import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  linkWithPopup,
  linkWithCredential,
  GoogleAuthProvider,
  signOut,
  type User as FirebaseUser,
} from "firebase/auth";
import {
  doc, getDoc, setDoc, updateDoc,
  collection, query, where, getDocs,
  serverTimestamp,
} from "firebase/firestore";
import { auth, db, googleProvider } from "@/lib/firebase";

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
  hasGoogle: boolean;              // true when Google is linked
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  linkGoogle: () => Promise<void>;
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
  const hasGoogle = firebaseUser.providerData.some((p) => p.providerId === "google.com");

  if (!snap.exists()) {
    const data = {
      email,
      org_profile: null,
      is_admin: adminFlag,
      role: adminFlag ? "admin" : "user",
      created_at: serverTimestamp(),
    };
    await setDoc(ref, data);
    return { id: firebaseUser.uid, email, org_profile: null, is_admin: adminFlag, role: adminFlag ? "admin" : "user", hasGoogle };
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
    hasGoogle,
  };
}

// ─── Context ──────────────────────────────────────────────────────────────────
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]       = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for a Google redirect result first (handles cases where popup was blocked)
    getRedirectResult(auth)
      .then(async (result) => {
        if (result?.user) {
          const authUser = await loadOrCreateUser(result.user);
          setUser(authUser);
        }
      })
      .catch(() => { /* redirect errors are handled downstream */ });

    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const authUser = await loadOrCreateUser(firebaseUser);
          setUser(authUser);
        } catch {
          setUser(null);
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  }, []);

  const signup = useCallback(async (email: string, password: string) => {
    await createUserWithEmailAndPassword(auth, email, password);
  }, []);

  // Google Sign-In: try popup, fall back to redirect; handle account linking
  const loginWithGoogle = useCallback(async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      const code: string = err.code ?? "";

      // If the popup was blocked, fall back to redirect-based flow
      if (
        code === "auth/popup-blocked" ||
        code === "auth/popup-cancelled" ||
        code === "auth/operation-not-supported-in-this-environment"
      ) {
        await signInWithRedirect(auth, googleProvider);
        return;
      }

      // If an account already exists with this email under a different provider,
      // surface a clear error so the UI can guide the user
      if (code === "auth/account-exists-with-different-credential") {
        const email = err.customData?.email ?? "your email";
        const pendingCred = GoogleAuthProvider.credentialFromError(err);
        // Surface a typed error so the caller can offer account-link flow
        const linkErr = new Error(
          `An account for "${email}" already exists with email/password. Sign in with your password, then link Google from your profile.`
        ) as any;
        linkErr.code = "account-exists";
        linkErr.pendingCred = pendingCred;
        linkErr.pendingEmail = email;
        throw linkErr;
      }

      throw err;
    }
  }, []);

  // Link a Google account to an existing email/password session
  const linkGoogle = useCallback(async () => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) throw new Error("Not signed in");
    try {
      await linkWithPopup(firebaseUser, googleProvider);
    } catch (err: any) {
      const code: string = err.code ?? "";
      if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
        // Can't easily do redirect-based linking; surface a useful message
        throw new Error("Popup was blocked by your browser. Please allow popups for this site and try again.");
      }
      if (code === "auth/credential-already-in-use" || code === "auth/provider-already-linked") {
        throw new Error("This Google account is already linked or in use by another account.");
      }
      throw err;
    }
    // Refresh user state after linking
    if (auth.currentUser) {
      const refreshed = await loadOrCreateUser(auth.currentUser);
      setUser(refreshed);
    }
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth);
    setUser(null);
  }, []);

  const updateProfile = useCallback(async (profile: OrgProfileData) => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) throw new Error("Not authenticated");
    const ref = doc(db, "users", firebaseUser.uid);
    await updateDoc(ref, { org_profile: profile });
    setUser((u) => (u ? { ...u, org_profile: profile } : u));
  }, []);

  const addAdmin = useCallback(async (email: string) => {
    const normalized = email.toLowerCase().trim();
    const q = query(collection(db, "users"), where("email", "==", normalized));
    const snap = await getDocs(q);
    if (snap.empty) throw new Error("No account found with that email address");
    const targetDoc = snap.docs[0];
    if (targetDoc.data().is_admin) throw new Error("That user is already an admin");
    await updateDoc(targetDoc.ref, { is_admin: true, role: "admin" });
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, loginWithGoogle, linkGoogle, logout, updateProfile, addAdmin }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
