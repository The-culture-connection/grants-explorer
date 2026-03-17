import React, { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth, type OrgProfileData } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OrgProfileForm } from "@/components/OrgProfileForm";
import {
  LayoutDashboard, Mail, Lock, CheckCircle2, AlertCircle,
  Eye, EyeOff, ArrowRight, ChevronRight,
} from "lucide-react";

type Step = "auth" | "profile" | "done";
type AuthMode = "signup" | "login";

export default function ProfileCreation() {
  const { login, signup, user, loading, updateProfile } = useAuth();
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

              <Button type="submit" className="w-full gap-2 rounded-xl h-10" disabled={authLoading}>
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
