"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      // Not the shared api() helper: a 401 here is the error to display, not a redirect.
      const res = await fetch(`/api/auth/${mode === "signin" ? "login" : "signup"}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        router.replace("/");
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
      if (body?.error === "unauthorized") {
        setError("That email and password do not match an account.");
      } else if (body?.error === "duplicate") {
        setError("An account with this email already exists. Sign in instead.");
      } else if (body?.error === "rate_limited") {
        setError("Too many attempts. Wait a few minutes and try again.");
      } else {
        setError(body?.message ?? "Something went wrong. Try again.");
      }
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-main">
      <div className="login-card">
        <h1>Shelfmark</h1>
        <p className="login-tagline">
          Save pages and paste text, then ask questions answered only from what you saved.
        </p>
        <form className="login-form" onSubmit={onSubmit} noValidate>
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error ? (
            <p className="login-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>
        <button
          type="button"
          className="login-switch"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
          }}
        >
          {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
        </button>
      </div>
    </main>
  );
}
