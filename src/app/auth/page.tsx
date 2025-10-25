"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

type Mode = "signin" | "signup";

export default function AuthPage() {
  const router = useRouter();
  const { signIn, signUp } = useAuth();

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const passwordMismatch = useMemo(() => {
    if (mode === "signin") {
      return false;
    }
    if (!password || !confirmPassword) {
      return false;
    }
    return password !== confirmPassword;
  }, [mode, password, confirmPassword]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setProcessing(true);
    setError(null);
    setMessage(null);

    if (passwordMismatch) {
      setError("Passwords do not match.");
      setProcessing(false);
      return;
    }

    const action = mode === "signin" ? signIn : signUp;
    const { error: actionError } = await action(email, password);

    if (actionError) {
      setError(actionError);
      setProcessing(false);
      return;
    }

    if (mode === "signup") {
      setMessage("Check your inbox to confirm your account before signing in.");
      setProcessing(false);
      return;
    }

    router.push("/");
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-black text-white">
      <div className="w-full max-w-md rounded-2xl border border-white/15 bg-black/60 p-8 shadow-lg shadow-black/40 backdrop-blur">
        <h1 className="text-3xl font-semibold">Welcome to ToneTerminal</h1>
        <p className="mt-2 text-sm text-slate-400">
          {mode === "signin"
            ? "Sign in with your email to continue."
            : "Create an account to start analyzing vocal chains."}
        </p>

        <form className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-2 text-sm">
            <span className="text-xs uppercase tracking-[0.3em] text-slate-500">
              Email
            </span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-md border border-white/20 bg-black/80 px-4 py-3 text-white outline-none transition hover:border-white/40 focus:border-white"
              required
              autoComplete="email"
            />
          </label>

          <label className="flex flex-col gap-2 text-sm">
            <span className="text-xs uppercase tracking-[0.3em] text-slate-500">
              Password
            </span>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-md border border-white/20 bg-black/80 px-4 py-3 pr-12 text-white outline-none transition hover:border-white/40 focus:border-white"
                  required
                  minLength={6}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((previous) => !previous)}
                  className="absolute inset-y-0 right-3 flex items-center text-xs uppercase tracking-[0.2em] text-slate-400 transition hover:text-white"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </label>

          {mode === "signup" && (
            <label className="flex flex-col gap-2 text-sm">
              <span className="text-xs uppercase tracking-[0.3em] text-slate-500">
                Confirm Password
              </span>
              <div className="relative">
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="w-full rounded-md border border-white/20 bg-black/80 px-4 py-3 pr-12 text-white outline-none transition hover:border-white/40 focus:border-white"
                  required
                  minLength={6}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((previous) => !previous)}
                  className="absolute inset-y-0 right-3 flex items-center text-xs uppercase tracking-[0.2em] text-slate-400 transition hover:text-white"
                >
                  {showConfirmPassword ? "Hide" : "Show"}
                </button>
              </div>
            </label>
          )}

          {error && (
            <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          )}

          {message && (
            <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={processing}
            className="mt-2 w-full rounded-full border border-white/30 px-6 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-white transition hover:border-white/60 hover:bg-white/5 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-white/40"
          >
            {processing
              ? "Processing…"
              : mode === "signin"
              ? "Sign In"
              : "Sign Up"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-500">
          {mode === "signin" ? (
            <>
              Need an account?{" "}
              <button
                type="button"
                onClick={() => setMode("signup")}
                className="text-white underline"
              >
                Sign up
              </button>
              .
            </>
          ) : (
            <>
              Already registered?{" "}
              <button
                type="button"
                onClick={() => setMode("signin")}
                className="text-white underline"
              >
                Sign in
              </button>
              .
            </>
          )}
        </p>
      </div>
    </div>
  );
}
