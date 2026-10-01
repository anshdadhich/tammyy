"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CircleAlert, Eye, EyeOff, Info, Loader2 } from "lucide-react";
import { SESSION_EVENT, signOut } from "@/lib/session-client";

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LEN = 320;

type Session = {
  email: string;
  name?: string;
  isAdmin?: boolean;
  employerStatus?: "verified" | "pending" | "none";
};

/** Flat success payload returned by POST /api/auth/{login,signup}. */
type AuthSuccess = {
  ok: true;
  email: string;
  kind: "hr" | "anon";
  isAdmin: boolean;
  name?: string;
  employerStatus: "verified" | "pending" | "none";
};

function passwordPolicyError(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (password.length > 200) return "Password must be at most 200 characters.";
  return null;
}

export default function LoginForm({
  initialSession,
  bare = false,
}: {
  initialSession: Session | null;
  bare?: boolean;
}) {
  const router = useRouter();
  const cardClass = bare
    ? ""
    : "rounded-2xl bg-surface shadow-soft-md p-7 sm:p-9";

  const [session, setSession] = useState<Session | null>(initialSession);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [stage, setStage] = useState<"form" | "company">(
    initialSession && !initialSession.isAdmin && initialSession.employerStatus !== "verified"
      ? "company"
      : "form",
  );
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [company, setCompany] = useState(initialSession?.name ?? "");
  const [website, setWebsite] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [coBusy, setCoBusy] = useState(false);
  const [coErr, setCoErr] = useState<string | null>(null);
  const [coDone, setCoDone] = useState(initialSession?.employerStatus === "pending");

  /** Branch on the flat auth payload: admin → /admin, verified → search,
   *  pending → review card, everything else → company registration. */
  const applySuccess = (data: AuthSuccess) => {
    const next: Session = {
      email: data.email,
      ...(data.name ? { name: data.name } : {}),
      ...(data.isAdmin ? { isAdmin: true } : {}),
      employerStatus: data.employerStatus,
    };
    setSession(next);
    setPassword("");
    setConfirm("");
    setErr(null);
    window.dispatchEvent(new Event(SESSION_EVENT));
    router.refresh();
    if (data.isAdmin) {
      router.push("/admin");
      return;
    }
    if (data.kind === "hr" && data.employerStatus === "verified") {
      router.push("/hire/search");
      return;
    }
    if (data.employerStatus === "pending") {
      setCompany(data.name ?? "");
      setCoDone(true);
      return;
    }
    // hr with no company yet (or an unclaimed identity) → register one.
    setStage("company");
  };

  const submitAuth = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    const trimmed = email.trim().toLowerCase();
    if (trimmed.length > MAX_EMAIL_LEN || !EMAIL_OK.test(trimmed)) {
      setErr("Enter a valid work email.");
      return;
    }
    if (!password) {
      setErr("Enter your password.");
      return;
    }
    if (mode === "signup") {
      const policy = passwordPolicyError(password);
      if (policy) {
        setErr(policy);
        return;
      }
      if (password !== confirm) {
        setErr("Passwords do not match.");
        return;
      }
    }
    setEmail(trimmed);
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch(mode === "signup" ? "/api/auth/signup" : "/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: trimmed, password }),
      });
      const data = (await res.json().catch(() => null)) as
        | (Partial<AuthSuccess> & { error?: unknown; code?: unknown })
        | null;
      if (res.status === 409 && data?.code === "exists") {
        setMode("signin");
        setConfirm("");
        setErr("That email already has an account. Sign in instead.");
        return;
      }
      if (!res.ok || !data?.ok || typeof data.email !== "string") {
        setErr(
          typeof data?.error === "string" && data.error
            ? data.error
            : "Could not sign in. Try again.",
        );
        return;
      }
      applySuccess(data as AuthSuccess);
    } catch {
      setErr("Network error - try again.");
    } finally {
      setBusy(false);
    }
  };

  const signOutNow = async () => {
    await signOut();
    setSession(null);
    setMode("signin");
    setStage("form");
    setErr(null);
    setEmail("");
    setPassword("");
    setConfirm("");
    setCompany("");
    setWebsite("");
    setLinkedin("");
    setCoErr(null);
    setCoDone(false);
    router.refresh();
  };

  const toggleMode = () => {
    setMode((m) => (m === "signin" ? "signup" : "signin"));
    setErr(null);
    setConfirm("");
  };

  const registerCompany = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const trimmed = company.trim();
    if (trimmed.length < 2 || coBusy) return;
    setCoBusy(true);
    setCoErr(null);
    try {
      const res = await fetch("/api/employers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          company_name: trimmed.slice(0, 200),
          website: website.trim().slice(0, 500),
          linkedin_url: linkedin.trim().slice(0, 500),
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        employerId?: unknown;
        status?: unknown;
        error?: unknown;
      } | null;
      if (!res.ok) {
        setCoErr(
          typeof data?.error === "string" && data.error
            ? data.error
            : "Could not register the company. Try again.",
        );
        return;
      }
      setSession((s) =>
        s ? { ...s, name: trimmed, employerStatus: "pending" } : s,
      );
      setCoDone(true);
      window.dispatchEvent(new Event(SESSION_EVENT));
      router.refresh();
    } catch {
      setCoErr("Network error - try again.");
    } finally {
      setCoBusy(false);
    }
  };

  if (session && stage === "company" && !coDone) {
    return (
      <form onSubmit={(ev) => void registerCompany(ev)} className={cardClass}>
        <div className="grid gap-4">
          <div className="field">
            <label className="field-label" htmlFor="hr-company">
              Company name
              <span className="req" aria-hidden="true">
                *
              </span>
            </label>
            <input
              id="hr-company"
              className="input"
              value={company}
              onChange={(e) => {
                setCompany(e.target.value);
                setCoErr(null);
              }}
              placeholder="Acme Inc"
              maxLength={200}
              aria-invalid={coErr ? true : undefined}
              required
            />
            {coErr ? (
              <span className="field-error" role="alert">
                {coErr}
              </span>
            ) : (
              <span className="field-hint">
                No company on file for {session.email} yet. Register it for verification.
              </span>
            )}
          </div>
          <div className="field">
            <label className="field-label" htmlFor="hr-website">
              Company website
              <span className="req" aria-hidden="true">
                *
              </span>
            </label>
            <input
              id="hr-website"
              className="input"
              value={website}
              onChange={(e) => {
                setWebsite(e.target.value);
                setCoErr(null);
              }}
              placeholder="https://acme.com"
              inputMode="url"
              maxLength={500}
              required
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="hr-linkedin">
              Your LinkedIn URL
              <span className="req" aria-hidden="true">
                *
              </span>
            </label>
            <input
              id="hr-linkedin"
              className="input"
              value={linkedin}
              onChange={(e) => {
                setLinkedin(e.target.value);
                setCoErr(null);
              }}
              placeholder="https://linkedin.com/in/you"
              inputMode="url"
              maxLength={500}
              required
            />
            <span className="field-hint">
              Used to confirm you work at this company.
            </span>
          </div>
        </div>
        <button
          type="submit"
          className="btn btn-primary press mt-6 w-full sm:w-auto"
          disabled={coBusy}
        >
          {coBusy ? (
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          ) : null}
          Register company <ArrowRight size={16} aria-hidden="true" />
        </button>
      </form>
    );
  }

  if (session && coDone) {
    return (
      <div className={cardClass}>
        <div className="flex items-center gap-2.5">
          <span
            className="pulse-dot inline-block w-2 h-2 rounded-full"
            style={{ background: "var(--warn)" }}
            aria-hidden="true"
          />
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            Verification pending
          </p>
        </div>
        <h2 className="mt-3 text-[22px] font-semibold tracking-[-0.01em] text-ink">
          Company submitted
        </h2>
        <p className="mt-2 text-[15px] leading-[1.6] text-body">
          An admin will verify {company.trim() || "your company"} shortly. Search unlocks
          once verification completes.
        </p>
        <div className="flex flex-wrap items-center gap-3 mt-6">
          <button
            type="button"
            className="btn btn-secondary press"
            onClick={() => void signOutNow()}
            disabled={busy}
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  if (session) {
    const heading = session.isAdmin
      ? "Signed in as Admin"
      : `Signed in as ${session.name || session.email}`;
    return (
      <div className={cardClass}>
        <div className="flex items-center gap-2.5">
          <span
            className="pulse-dot inline-block w-2 h-2 rounded-full"
            style={{ background: "var(--success)" }}
            aria-hidden="true"
          />
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            Session open
          </p>
        </div>
        <h2 className="mt-3 text-[22px] font-semibold tracking-[-0.01em] text-ink">
          {heading}
        </h2>
        <p className="mt-2 text-[15px] leading-[1.6] text-body">
          {session.name && !session.isAdmin ? session.email : "This device holds the employer session."}{" "}
          Search, shortlists, and contact channels are unlocked.
        </p>
        <div className="flex flex-wrap items-center gap-3 mt-6">
          {session.isAdmin ? (
            <Link href="/admin" className="btn btn-primary press">
              Open admin <ArrowRight size={16} aria-hidden="true" />
            </Link>
          ) : (
            <Link href="/hire/search" className="btn btn-primary press">
              Start a search <ArrowRight size={16} aria-hidden="true" />
            </Link>
          )}
          <button
            type="button"
            className="btn btn-secondary press"
            onClick={() => void signOutNow()}
            disabled={busy}
          >
            Sign out
          </button>
        </div>
        <div className="notice mt-6">
          <Info aria-hidden="true" />
          <span>
            The session lives in a signed-in browser tab on this device. Use
            sign out to end it.
          </span>
        </div>
      </div>
    );
  }

  const isSignup = mode === "signup";
  return (
    <form onSubmit={(ev) => void submitAuth(ev)} className={cardClass}>
      <div className="grid gap-4">
        <div className="field">
          <label className="field-label" htmlFor="hr-email">
            Work email
            <span className="req" aria-hidden="true">
              *
            </span>
          </label>
          <input
            id="hr-email"
            className="input"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setErr(null);
            }}
            placeholder="you@company.com"
            autoComplete="email"
            maxLength={MAX_EMAIL_LEN}
            required
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="hr-password">
            Password
            <span className="req" aria-hidden="true">
              *
            </span>
          </label>
          <div className="relative">
            <input
              id="hr-password"
              className="input pr-11"
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setErr(null);
              }}
              placeholder={isSignup ? "At least 8 characters" : "Your password"}
              autoComplete={isSignup ? "new-password" : "current-password"}
              maxLength={200}
              aria-invalid={err ? true : undefined}
              required
            />
            <button
              type="button"
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted hover:text-body"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? "Hide password" : "Show password"}
              tabIndex={-1}
            >
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {!isSignup && !err ? (
            <span className="field-hint">Use the password for this account.</span>
          ) : null}
        </div>
        {isSignup ? (
          <div className="field">
            <label className="field-label" htmlFor="hr-confirm">
              Confirm password
              <span className="req" aria-hidden="true">
                *
              </span>
            </label>
            <input
              id="hr-confirm"
              className="input"
              type={showPw ? "text" : "password"}
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                setErr(null);
              }}
              placeholder="Repeat the password"
              autoComplete="new-password"
              maxLength={200}
              required
            />
          </div>
        ) : null}
      </div>

      {err ? (
        <p className="field-error mt-4" role="alert">
          {err}
        </p>
      ) : null}

      <button
        type="submit"
        className="btn btn-primary press mt-6 w-full sm:w-auto"
        disabled={busy}
      >
        {busy ? (
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
        ) : null}
        {isSignup ? "Create account" : "Sign in"} <ArrowRight size={16} aria-hidden="true" />
      </button>

      <p className="field-hint mt-4">
        {isSignup ? "Already have an account?" : "New to hiring on Tammy?"}{" "}
        <button
          type="button"
          className="underline font-semibold text-body"
          onClick={toggleMode}
          disabled={busy}
        >
          {isSignup ? "Sign in instead" : "Create an account"}
        </button>
      </p>

      <div className="notice mt-6">
        <CircleAlert aria-hidden="true" />
        <span>
          Your password is stored on this server only. Search, shortlists, and
          contact channels unlock once your company is verified.
        </span>
      </div>

      <p className="field-hint mt-4">
        Hiring for the first time?{" "}
        <Link href="/hire" className="underline font-semibold text-body">
          See how the search works
        </Link>
        .
      </p>
    </form>
  );
}
