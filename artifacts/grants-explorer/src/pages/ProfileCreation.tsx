import React, { useState } from "react";
import { useLocation } from "wouter";
import { useAuth, type OrgProfileData } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LayoutDashboard, Mail, Lock, User, CheckCircle2, AlertCircle, Eye, EyeOff, ArrowRight, ChevronRight } from "lucide-react";

const DEFAULT_PROFILE: OrgProfileData = {
  id: "",
  name: "",
  org_type: "nonprofit",
  mission: "",
  program_areas: [],
  population_served: [],
  geography: [],
  annual_budget: 0,
  years_in_operation: 0,
  has_501c3: false,
  is_small_business: false,
  keywords: [],
};

const PROFILE_TEMPLATE = `{
  "id": "my-org",
  "name": "My Organization",
  "org_type": "nonprofit",
  "mission": "Describe your organization's mission and core purpose here.",
  "program_areas": ["education", "workforce development"],
  "population_served": ["low-income youth", "adults 18-35"],
  "geography": ["United States", "California"],
  "annual_budget": 500000,
  "years_in_operation": 5,
  "has_501c3": true,
  "is_small_business": false,
  "keywords": ["job training", "mentorship", "community development"]
}`;

type Step = "auth" | "profile" | "done";
type AuthMode = "signup" | "login";

export default function ProfileCreation() {
  const { login, signup, user, updateProfile } = useAuth();
  const [, navigate] = useLocation();

  const [step, setStep] = useState<Step>(user ? "profile" : "auth");
  const [authMode, setAuthMode] = useState<AuthMode>("signup");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const [profileJson, setProfileJson] = useState(PROFILE_TEMPLATE);
  const [profileError, setProfileError] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);

  async function handleAuth(e: React.FormEvent) {
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
      setStep("profile");
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileError("");
    let parsed: OrgProfileData;
    try {
      parsed = JSON.parse(profileJson);
    } catch {
      setProfileError("Invalid JSON — please fix the syntax above");
      return;
    }
    if (!parsed.name || !parsed.mission) {
      setProfileError("Profile must include at least a name and mission");
      return;
    }
    if (!parsed.id) parsed.id = parsed.name.toLowerCase().replace(/\s+/g, "-");
    setProfileLoading(true);
    try {
      await updateProfile(parsed);
      setStep("done");
      setTimeout(() => navigate("/"), 1500);
    } catch (err: any) {
      setProfileError(err.message);
    } finally {
      setProfileLoading(false);
    }
  }

  const steps = [
    { key: "auth", label: authMode === "signup" ? "Create Account" : "Sign In" },
    { key: "profile", label: "Organization Profile" },
    { key: "done", label: "All Set!" },
  ];
  const stepIndex = steps.findIndex((s) => s.key === step);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Nav */}
      <nav className="border-b border-border/60 bg-background/90 backdrop-blur-md">
        <div className="max-w-4xl mx-auto px-4 h-12 flex items-center">
          <div className="flex items-center gap-1.5 font-semibold text-sm text-foreground">
            <LayoutDashboard className="h-4 w-4 text-primary" />
            Grants Explorer
          </div>
        </div>
      </nav>

      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-10">
          {steps.map((s, i) => (
            <React.Fragment key={s.key}>
              <div className={`flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-full transition-all ${i === stepIndex ? "bg-primary text-primary-foreground" : i < stepIndex ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>
                {i < stepIndex ? <CheckCircle2 className="h-3 w-3" /> : <span className="w-3.5 h-3.5 rounded-full border border-current flex items-center justify-center text-[9px]">{i + 1}</span>}
                {s.label}
              </div>
              {i < steps.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
            </React.Fragment>
          ))}
        </div>

        {/* Step 1 — Auth */}
        {step === "auth" && (
          <div className="w-full max-w-md">
            <div className="text-center mb-8">
              <h1 className="text-2xl font-bold text-foreground mb-2">
                {authMode === "signup" ? "Create your account" : "Welcome back"}
              </h1>
              <p className="text-sm text-muted-foreground">
                {authMode === "signup"
                  ? "Set up your account to start discovering grants matched to your organization"
                  : "Sign in to access your personalized grant matches"}
              </p>
            </div>

            <form onSubmit={handleAuth} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs font-medium text-foreground">Email address</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@organization.org"
                    className="pl-9"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs font-medium text-foreground">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPass ? "text" : "password"}
                    placeholder="Minimum 8 characters"
                    className="pl-9 pr-9"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete={authMode === "signup" ? "new-password" : "current-password"}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {authMode === "signup" && (
                <div className="space-y-1.5">
                  <Label htmlFor="confirm-password" className="text-xs font-medium text-foreground">Confirm password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="confirm-password"
                      type={showPass ? "text" : "password"}
                      placeholder="Re-enter your password"
                      className="pl-9"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                    />
                  </div>
                </div>
              )}

              {authError && (
                <div className="flex items-center gap-2 text-xs text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  {authError}
                </div>
              )}

              <Button type="submit" className="w-full gap-2" disabled={authLoading}>
                {authLoading ? "Please wait…" : authMode === "signup" ? "Create Account" : "Sign In"}
                {!authLoading && <ArrowRight className="h-4 w-4" />}
              </Button>
            </form>

            <div className="mt-6 text-center">
              <button
                type="button"
                onClick={() => { setAuthMode(authMode === "signup" ? "login" : "signup"); setAuthError(""); }}
                className="text-xs text-muted-foreground hover:text-primary transition-colors"
              >
                {authMode === "signup"
                  ? "Already have an account? Sign in"
                  : "Don't have an account? Create one"}
              </button>
            </div>
          </div>
        )}

        {/* Step 2 — Profile */}
        {step === "profile" && (
          <div className="w-full max-w-2xl">
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-4">
                <User className="h-6 w-6 text-primary" />
              </div>
              <h1 className="text-2xl font-bold text-foreground mb-2">Set up your organization profile</h1>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                This profile is used by the V3 algorithm to find grants that match your organization's mission, eligibility, and focus areas.
              </p>
            </div>

            <form onSubmit={handleProfile} className="space-y-4">
              <div className="border border-border/60 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between bg-muted/50 px-4 py-2.5 border-b border-border/60">
                  <span className="text-xs font-mono font-medium text-muted-foreground">org_profile.json</span>
                  <span className="text-xs text-muted-foreground">Edit all fields below</span>
                </div>
                <Textarea
                  value={profileJson}
                  onChange={(e) => setProfileJson(e.target.value)}
                  className="font-mono text-xs min-h-[400px] rounded-none border-0 resize-none focus-visible:ring-0 focus-visible:ring-offset-0 bg-background"
                  spellCheck={false}
                />
              </div>

              <div className="bg-muted/30 border border-border/40 rounded-lg px-4 py-3 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">Field reference:</p>
                <p><span className="font-mono text-primary">org_type</span>: "nonprofit" | "small_business" | "university" | "government" | "individual" | "other"</p>
                <p><span className="font-mono text-primary">program_areas</span>, <span className="font-mono text-primary">population_served</span>, <span className="font-mono text-primary">geography</span>, <span className="font-mono text-primary">keywords</span>: JSON arrays of strings</p>
                <p><span className="font-mono text-primary">annual_budget</span>, <span className="font-mono text-primary">years_in_operation</span>: numbers</p>
                <p><span className="font-mono text-primary">has_501c3</span>, <span className="font-mono text-primary">is_small_business</span>: true or false</p>
              </div>

              {profileError && (
                <div className="flex items-center gap-2 text-xs text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  {profileError}
                </div>
              )}

              <div className="flex gap-3">
                <Button type="submit" className="flex-1 gap-2" disabled={profileLoading}>
                  {profileLoading ? "Saving…" : "Save Profile & Continue"}
                  {!profileLoading && <ArrowRight className="h-4 w-4" />}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { navigate("/"); }}
                  className="text-muted-foreground"
                >
                  Skip for now
                </Button>
              </div>
            </form>
          </div>
        )}

        {/* Step 3 — Done */}
        {step === "done" && (
          <div className="text-center space-y-4">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 dark:bg-green-950/40 mb-2">
              <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">You're all set!</h1>
            <p className="text-sm text-muted-foreground">Taking you to the home screen…</p>
          </div>
        )}
      </div>
    </div>
  );
}
