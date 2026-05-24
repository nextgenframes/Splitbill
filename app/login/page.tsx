"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/browser";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");

  const hashError = useMemo(() => {
    if (typeof window === "undefined") return null;
    const raw = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
    if (!raw) return null;
    const params = new URLSearchParams(raw);
    const error = params.get("error");
    const code = params.get("error_code");
    const desc = params.get("error_description");
    if (!error && !desc) return null;
    return { error, code, desc };
  }, []);

  useEffect(() => {
    if (!hashError) return;
    const text = hashError.desc
      ? decodeURIComponent(hashError.desc.replaceAll("+", " "))
      : "Sign-in link error.";
    setMessage(
      `${text} If this keeps happening, your email app may be pre-opening the link. Try copying link into Safari/Chrome, or hit resend.`
    );
    // Clear fragment so refresh doesn't keep re-showing.
    window.history.replaceState(null, "", window.location.pathname);
  }, [hashError]);

  async function submit() {
    setLoading(true);
    setMessage("");

    try {
      const supabase = createClient();
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace("/dashboard");
        return;
      }

      const { error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      setMessage("Account created. You can sign in now.");
      setMode("signin");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Supabase config error.";
      setMessage(
        msg === "Failed to fetch"
          ? "Failed to fetch Supabase. Check NEXT_PUBLIC_SUPABASE_URL is https://<project-ref>.supabase.co and env vars are deployed. Try /api/supabase-health."
          : msg
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-950 text-white">
            <WalletCards className="h-5 w-5" />
          </div>
          <CardTitle className="text-2xl">Sign in to SplitNest</CardTitle>
          <p className="text-sm text-muted-foreground">
            Secure household bill splitting with transparent receipts.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 rounded-2xl border bg-muted p-1">
            <button
              type="button"
              onClick={() => setMode("signin")}
              className={`min-h-11 rounded-xl text-sm font-medium transition ${
                mode === "signin" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              className={`min-h-11 rounded-xl text-sm font-medium transition ${
                mode === "signup" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Create account
            </button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          <Button className="w-full min-h-12" onClick={submit} disabled={loading || !email || password.length < 8} variant="dark">
            {loading ? "Working..." : mode === "signin" ? "Sign in" : "Create account"}
          </Button>
          <p className="text-xs text-muted-foreground">Password minimum 8 characters.</p>
          {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        </CardContent>
      </Card>
    </main>
  );
}
