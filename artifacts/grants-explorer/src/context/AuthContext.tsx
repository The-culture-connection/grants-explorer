import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;

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

export interface AuthUser {
  id: number;
  email: string;
  org_profile: OrgProfileData | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => void;
  updateProfile: (profile: OrgProfileData) => Promise<void>;
  apiHeaders: () => Record<string, string>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const apiHeaders = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (token) h["Authorization"] = `Bearer ${token}`;
    return h;
  }, [token]);

  useEffect(() => {
    const savedToken = localStorage.getItem("ge_token");
    if (!savedToken) {
      setLoading(false);
      return;
    }
    setToken(savedToken);
    fetch(`${API}/auth/me`, {
      headers: { Authorization: `Bearer ${savedToken}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.user) setUser(data.user);
        else {
          localStorage.removeItem("ge_token");
          setToken(null);
        }
      })
      .catch(() => {
        localStorage.removeItem("ge_token");
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Login failed");
    localStorage.setItem("ge_token", data.token);
    setToken(data.token);
    setUser(data.user);
  }, []);

  const signup = useCallback(async (email: string, password: string) => {
    const r = await fetch(`${API}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Signup failed");
    localStorage.setItem("ge_token", data.token);
    setToken(data.token);
    setUser(data.user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("ge_token");
    setToken(null);
    setUser(null);
  }, []);

  const updateProfile = useCallback(async (profile: OrgProfileData) => {
    const savedToken = localStorage.getItem("ge_token");
    const r = await fetch(`${API}/auth/profile`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${savedToken}`,
      },
      body: JSON.stringify({ org_profile: profile }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Profile update failed");
    setUser((u) => (u ? { ...u, org_profile: profile } : u));
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, signup, logout, updateProfile, apiHeaders }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
