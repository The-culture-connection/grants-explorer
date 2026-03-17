import React, { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth, type OrgProfileData } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OrgProfileForm } from "@/components/OrgProfileForm";
import {
  LayoutDashboard, Mail, Lock, CheckCircle2, AlertCircle,
  Eye, EyeOff, ArrowRight, ChevronRight, Chrome
} from "lucide-react";

type Step = "auth" | "profile" | "done";
type AuthMode = "signup" | "login";

export default function ProfileCreation() {
  const { login, signup, loginWithGoogle, user, loading, updateProfile } = useAuth();
  const [, navigate] = useLocation();

  // Determine initial step based on auth state
  function initialStep(): Step {
    if (!user) return "auth";
    if (user.org_profile) return "done"; // will redirect below
    return "profile";
  }

  const [step, setStep]           = useState<Step>(initialStep);
  const [authMode, setAuthMode]   = useState<AuthMode>("signup");
  const [email, setEmail]         = useState("");
  const [password, setPassword]   = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPass, setShowPass]   = useState(false);
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError]   = useState("");

  // If user is already signed in, handle routing
  useEffect(() => {
    if (loading) return;
    if (user?.org_profile) {
      // Already has a complete profile — go straight to dashboard
      navigate("/");
    } else if (user && !user.org_profile) {
      // Signed in but no profile yet — show profile step
      setStep("profile");
    }
  }, [user, loading, navigate]);

  async function handleEmailAuth(e: React.FormEvent) {
    e.preventDefault();
    setAuthError("");
    if (authMode === "signup" && password !== confirmPassword) {
      setAuthError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setAuthError("Password must be at least 8 characters");
      return;
    }
    setAuthLoading(true);
    try {
      if (authMode === "signup") {
        await signup(email, password);
      } else {
        await login(email, password);
      }
      // useEffect above will handle navigation based on whether user has org_profile
    } catch (err: any) {
      const msg: string = err.message ?? "Authentication failed";
      // Make Firebase error messages human-readable
      if (msg.includes("email-already-in-use"))  setAuthError("An account with this email already exists. Sign in instead.");
      else if (msg.includes("user-not-found"))   setAuthError("No account found with this email.");
      else if (msg.includes("wrong-password"))   setAuthError("Incorrect password.");
      else if (msg.includes("invalid-credential")) setAuthError("Invalid email or password.");
      else if (msg.includes("too-many-requests")) setAuthError("Too many attempts. Please try again later.");
      else setAuthError(msg);
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleGoogleAuth() {
    setAuthError("");
    setGoogleLoading(true);
    try {
      await loginWithGoogle();
      // useEffect handles routing
    } catch (err: any) {
      const msg: string = err.message ?? "";
      if (msg.includes("popup-closed-by-user") || msg.includes("cancelled-popup-request")) {
        // User dismissed — not an error
      } else {
        setAuthError("Google sign-in failed. Please try again.");
      }
    } finally {
      setGoogleLoading(false);
    }
  }

  async function handleProfileSave(profile: OrgProfileData) {
    setProfileSaving(true);
    setProfileError("");
    try {
      await updateProfile(profile);
      setStep("done");
      setTimeout(() => navigate("/"), 1500);
    } catch (err: any) {
      setProfileError(err.message ?? "Failed to save profile");
      throw err;
    } finally {
      setProfileSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const wizardSteps = [
    { key: "auth",    label: authMode === "signup" ? "Create Account" : "Sign In" },
    { key: "profile", label: "Organization Profile" },
    { key: "done",    label: "All Set!" },
  ];
  const stepIndex = wizardSteps.findIndex((s) => s.key === step);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Nav */}
      <nav className="border-b border-border/60 bg-background/90 backdrop-blur-md">
        <div className="max-w-4xl mx-auto px-4 h-13 flex items-center">
          <div className="flex items-center gap-2 font-bold text-sm text-foreground py-3">
            <div className="w-6 h-6 rounded-md bg-primary flex items-center justify-center">
              <LayoutDashboard className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            Grants Explorer
          </div>
        </div>
      </nav>

      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        {/* Step indicators */}
        <div className="flex items-center gap-2 mb-10">
          {wizardSteps.map((s, i) => (
            <React.Fragment key={s.key}>
              <div className={`flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-full transition-all ${
                i === stepIndex ? "bg-primary text-primary-foreground shadow-sm"
                : i < stepIndex ? "bg-primary/15 text-primary"
                : "bg-muted text-muted-foreground"
              }`}>
                {i < stepIndex
                  ? <CheckCircle2 className="h-3 w-3" />
                  : <span className="w-3.5 h-3.5 rounded-full border border-current flex items-center justify-center text-[9px]">{i + 1}</span>
                }
                {s.label}
              </div>
              {i < wizardSteps.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />}
            </React.Fragment>
          ))}
        </div>

        {/* ── Step 1: Auth ── */}
        {step === "auth" && (
          <div className="w-full max-w-md">
            <div className="text-center mb-8 space-y-2">
              <h1 className="text-2xl font-bold text-foreground">
                {authMode === "signup" ? "Create your account" : "Welcome back"}
              </h1>
              <p className="text-sm text-muted-foreground">
                {authMode === "signup"
                  ? "Set up your account to discover grants matched to your organization"
                  : "Sign in to access your personalized grant matches"}
              </p>
            </div>

            {/* Google sign-in */}
            <button
              type="button"
              onClick={handleGoogleAuth}
              disabled={googleLoading || authLoading}
              className="w-full flex items-center justify-center gap-3 h-10 px-4 rounded-xl border-2 border-border/70 bg-background hover:bg-muted/50 hover:border-border transition-all text-sm font-medium text-foreground disabled:opacity-50 mb-5 shadow-sm"
            >
              {googleLoading ? (
                <div className="w-4 h-4 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
              )}
              {googleLoading ? "Signing in…" : `Continue with Google`}
            </button>

            {/* Divider */}
            <div className="flex items-center gap-3 mb-5">
              <div className="flex-1 border-t border-border/50" />
              <span className="text-[11px] text-muted-foreground font-medium px-1">or continue with email</span>
              <div className="flex-1 border-t border-border/50" />
            </div>

            <form onSubmit={handleEmailAuth} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs font-semibold text-foreground">Email address</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input id="email" type="email" placeholder="you@organization.org"
                    className="pl-9 rounded-xl" value={email}
                    onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs font-semibold text-foreground">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input id="password" type={showPass ? "text" : "password"} placeholder="Minimum 8 characters"
                    className="pl-9 pr-9 rounded-xl" value={password}
                    onChange={(e) => setPassword(e.target.value)} required
                    autoComplete={authMode === "signup" ? "new-password" : "current-password"} />
                  <button type="button" onClick={() => setShowPass(!showPass)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {authMode === "signup" && (
                <div className="space-y-1.5">
                  <Label htmlFor="confirm-password" className="text-xs font-semibold text-foreground">Confirm password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input id="confirm-password" type={showPass ? "text" : "password"} placeholder="Re-enter your password"
                      className="pl-9 rounded-xl" value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)} required />
                  </div>
                </div>
              )}

              {authError && (
                <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2.5">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {authError}
                </div>
              )}

              <Button type="submit" className="w-full gap-2 rounded-xl h-10" disabled={authLoading || googleLoading}>
                {authLoading
                  ? <><div className="w-4 h-4 border-2 border-primary-foreground/50 border-t-transparent rounded-full animate-spin" /> Please wait…</>
                  : <>{authMode === "signup" ? "Create Account" : "Sign In"} <ArrowRight className="h-4 w-4" /></>
                }
              </Button>
            </form>

            <div className="mt-5 text-center">
              <button type="button"
                onClick={() => { setAuthMode(authMode === "signup" ? "login" : "signup"); setAuthError(""); }}
                className="text-xs text-muted-foreground hover:text-primary transition-colors">
                {authMode === "signup" ? "Already have an account? Sign in" : "Don't have an account? Create one"}
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Profile ── */}
        {step === "profile" && (
          <div className="w-full max-w-2xl">
            <div className="text-center mb-8 space-y-2">
              <h1 className="text-2xl font-bold text-foreground">Set up your organization profile</h1>
              <p className="text-sm text-muted-foreground">
                Answer a few questions so we can find the best-matching grants for you.
              </p>
            </div>

            {profileError && (
              <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2.5 mb-4">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {profileError}
              </div>
            )}

            <OrgProfileForm
              initial={user?.org_profile}
              onSave={handleProfileSave}
              saving={profileSaving}
              saveLabel="Complete Setup"
              onCancel={() => navigate("/")}
            />

            <div className="mt-4 text-center">
              <button type="button" onClick={() => navigate("/")}
                className="text-xs text-muted-foreground hover:text-primary transition-colors">
                Skip for now — I'll complete this later
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Done ── */}
        {step === "done" && (
          <div className="text-center space-y-4">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-950/40">
              <CheckCircle2 className="h-10 w-10 text-emerald-600 dark:text-emerald-400" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">You're all set!</h1>
            <p className="text-sm text-muted-foreground">Taking you to your dashboard…</p>
          </div>
        )}
      </div>
    </div>
  );
}
