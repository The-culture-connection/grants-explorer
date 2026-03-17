import { useState } from "react";
import { Lock, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const SESSION_KEY = "dev_gate_pass";
const DEV_PASSWORD = "Grace516!";

export default function DevGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [input, setInput] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState(false);
  const [unlocked, setUnlocked] = useState(
    () => sessionStorage.getItem(SESSION_KEY) === "1",
  );

  if (loading) return null;

  if (user?.is_admin || unlocked) return <>{children}</>;

  function attempt(e: React.FormEvent) {
    e.preventDefault();
    if (input === DEV_PASSWORD) {
      sessionStorage.setItem(SESSION_KEY, "1");
      setUnlocked(true);
    } else {
      setError(true);
      setInput("");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30">
      <div className="w-full max-w-sm mx-4">
        <form
          onSubmit={attempt}
          className="bg-background border border-border rounded-2xl shadow-lg p-8 space-y-6"
        >
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Lock className="h-6 w-6 text-primary" />
            </div>
            <h1 className="text-xl font-semibold text-foreground">Internal tool</h1>
            <p className="text-sm text-muted-foreground">
              Enter the access password to continue.
            </p>
          </div>

          <div className="space-y-2">
            <div className="relative">
              <Input
                type={show ? "text" : "password"}
                value={input}
                onChange={(e) => { setInput(e.target.value); setError(false); }}
                placeholder="Password"
                autoFocus
                className={error ? "border-destructive pr-10" : "pr-10"}
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {error && (
              <p className="text-xs text-destructive">Incorrect password. Try again.</p>
            )}
          </div>

          <Button type="submit" className="w-full">
            Unlock
          </Button>
        </form>
      </div>
    </div>
  );
}
