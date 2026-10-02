"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Stage = "signin" | "signup" | "company";

type ApiFailure = {
  error?: unknown;
  errors?: { fieldErrors?: Record<string, string[] | undefined> };
};

function messageOf(json: ApiFailure, fallback: string): string {
  if (typeof json.error === "string" && json.error.trim()) return json.error;
  const fieldErrors = json.errors?.fieldErrors;
  if (fieldErrors) {
    for (const messages of Object.values(fieldErrors)) {
      if (messages && messages[0]) return messages[0];
    }
  }
  return fallback;
}

const eyeIcon = (
  <svg
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const arrowIcon = (
  <svg
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </svg>
);

const infoIcon = (
  <svg
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="12" x2="12" y1="8" y2="12" />
    <line x1="12" x2="12.01" y1="16" y2="16" />
  </svg>
);

const passwordNotice = (
  <span>
    Your password is stored on this server only. Search, shortlists, and contact channels unlock
    once your company is verified.
  </span>
);

const searchWorksLink = (
  <p className="field-hint mt-4">
    Hiring for the first time?{" "}
    <Link href="/hire" className="underline font-semibold text-body">
      See how the search works
    </Link>
    .
  </p>
);

export default function LoginForm({ initialStage = "signin" }: { initialStage?: "signin" | "company" }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>(initialStage);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [registered, setRegistered] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");

  function go(next: Stage) {
    if (pending) return;
    setError("");
    setRegistered(false);
    setStage(next);
  }

  async function post(path: string, payload: unknown) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json().catch(() => ({}))) as ApiFailure & Record<string, unknown>;
    return { ok: res.ok, status: res.status, json };
  }

  async function onSignIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const { ok, json } = await post("/api/auth/login", { email, password });
      if (!ok) {
        setError(messageOf(json, "Something went wrong"));
        return;
      }
      if (!json.isAdmin && json.employerStatus === "none") {
        setStage("company");
        router.refresh();
        return;
      }
      router.push("/hire/search");
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setPending(false);
    }
  }

  async function onSignUp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const { ok, status, json } = await post("/api/auth/signup", { email, password });
      if (!ok) {
        const message = messageOf(json, "Something went wrong");
        if (status === 409 && json.code === "exists") {
          setStage("signin");
          setError(message);
          return;
        }
        setError(message);
        return;
      }
      setStage("company");
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setPending(false);
    }
  }

  async function onRegister(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const trimmedEmail = companyEmail.trim();
    setPending(true);
    setError("");
    try {
      const { ok, json } = await post("/api/employers", {
        company_name: companyName.trim(),
        website: website.trim(),
        linkedin_url: linkedinUrl.trim(),
        ...(trimmedEmail ? { company_email: trimmedEmail } : {}),
      });
      if (!ok) {
        setError(messageOf(json, "Something went wrong"));
        return;
      }
      router.refresh();
      if (json.status === "verified") {
        router.push("/hire/search");
        return;
      }
      setRegistered(true);
    } catch {
      setError("Network error");
    } finally {
      setPending(false);
    }
  }

  const errorSlot = error ? (
    <p className="field-error mt-4" aria-live="polite">
      {error}
    </p>
  ) : null;

  if (registered) {
    return (
      <div>
        <div className="notice">
          {infoIcon}
          <span>
            <span className="notice-ok">Company registered, verification pending.</span> Search,
            shortlists, and contact channels unlock once your company is verified.
          </span>
        </div>
        <Link href="/hire" className="btn btn-secondary press mt-6">
          Back to hiring overview
        </Link>
      </div>
    );
  }

  if (stage === "signup") {
    return (
      <form onSubmit={onSignUp}>
        <div className="grid gap-4">
          <div className="field">
            <label className="field-label" htmlFor="hr-signup-email">
              Work email <span className="req" aria-hidden="true">*</span>
            </label>
            <input
              id="hr-signup-email"
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoComplete="email"
              maxLength={320}
              required
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="hr-signup-password">
              Password <span className="req" aria-hidden="true">*</span>
            </label>
            <div className="relative">
              <input
                id="hr-signup-password"
                className="input pr-11"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password"
                autoComplete="new-password"
                maxLength={200}
                required
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted hover:text-body"
                aria-label={showPassword ? "Hide password" : "Show password"}
                tabIndex={0}
                onClick={() => setShowPassword((v) => !v)}
              >
                {eyeIcon}
              </button>
            </div>
            <span className="field-hint">Use at least 8 characters.</span>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="hr-confirm-password">
              Confirm password <span className="req" aria-hidden="true">*</span>
            </label>
            <input
              id="hr-confirm-password"
              className="input"
              type={showConfirm ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Re-enter your password"
              autoComplete="new-password"
              maxLength={200}
              required
            />
            <span className="field-hint">Both passwords must match.</span>
          </div>
        </div>

        {errorSlot}

        <button
          type="submit"
          className="btn btn-primary press mt-6 w-full sm:w-auto"
          disabled={pending}
        >
          {pending ? "Creating account…" : "Create account"} {arrowIcon}
        </button>

        <p className="field-hint mt-4">
          Already have an account?{" "}
          <button
            type="button"
            className="underline font-semibold text-body"
            onClick={() => go("signin")}
          >
            Sign in
          </button>
        </p>

        <div className="notice mt-6">
          {infoIcon}
          {passwordNotice}
        </div>

        {searchWorksLink}
      </form>
    );
  }

  if (stage === "company") {
    return (
      <form onSubmit={onRegister}>
        <div className="grid gap-4">
          <div className="field">
            <label className="field-label" htmlFor="co-name">
              Company name <span className="req" aria-hidden="true">*</span>
            </label>
            <input
              id="co-name"
              className="input"
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Acme Inc."
              maxLength={200}
              required
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="co-email">
              Company email
            </label>
            <input
              id="co-email"
              className="input"
              type="email"
              value={companyEmail}
              onChange={(e) => setCompanyEmail(e.target.value)}
              placeholder="you@company.com"
              autoComplete="email"
              maxLength={320}
            />
            <span className="field-hint">Optional - it falls back to your sign-in email.</span>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="co-website">
              Company website <span className="req" aria-hidden="true">*</span>
            </label>
            <input
              id="co-website"
              className="input"
              type="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://company.com"
              maxLength={500}
              required
            />
            <span className="field-hint">Use the full URL, starting with https.</span>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="co-linkedin">
              LinkedIn page <span className="req" aria-hidden="true">*</span>
            </label>
            <input
              id="co-linkedin"
              className="input"
              type="url"
              value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.target.value)}
              placeholder="https://www.linkedin.com/company/acme"
              maxLength={500}
              required
            />
            <span className="field-hint">Company or profile URL on linkedin.com.</span>
          </div>
        </div>

        {errorSlot}

        <button
          type="submit"
          className="btn btn-primary press mt-6 w-full sm:w-auto"
          disabled={pending}
        >
          {pending ? "Registering…" : "Register company"} {arrowIcon}
        </button>

        <p className="field-hint mt-4">
          Already have an account?{" "}
          <button
            type="button"
            className="underline font-semibold text-body"
            onClick={() => go("signin")}
          >
            Sign in
          </button>
        </p>

        <div className="notice mt-6">
          {infoIcon}
          <span>Search, shortlists, and contact channels unlock once your company is verified.</span>
        </div>

        {searchWorksLink}
      </form>
    );
  }

  return (
    <form onSubmit={onSignIn}>
      <div className="grid gap-4">
        <div className="field">
          <label className="field-label" htmlFor="hr-email">
            Work email <span className="req" aria-hidden="true">*</span>
          </label>
          <input
            id="hr-email"
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            autoComplete="email"
            maxLength={320}
            required
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="hr-password">
            Password <span className="req" aria-hidden="true">*</span>
          </label>
          <div className="relative">
            <input
              id="hr-password"
              className="input pr-11"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              autoComplete="current-password"
              maxLength={200}
              required
            />
            <button
              type="button"
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted hover:text-body"
              aria-label={showPassword ? "Hide password" : "Show password"}
              tabIndex={0}
              onClick={() => setShowPassword((v) => !v)}
            >
              {eyeIcon}
            </button>
          </div>
          <span className="field-hint">Use the password for this account.</span>
        </div>
      </div>

      {errorSlot}

      <button type="submit" className="btn btn-primary press mt-6 w-full sm:w-auto" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"} {arrowIcon}
      </button>

      <p className="field-hint mt-4">
        New to hiring on Tammy?{" "}
        <button
          type="button"
          className="underline font-semibold text-body"
          onClick={() => go("signup")}
        >
          Create an account
        </button>
      </p>

      <div className="notice mt-6">
        {infoIcon}
        {passwordNotice}
      </div>

      {searchWorksLink}

      <p className="field-hint mt-4">
        Hiring as a company?{" "}
        <button
          type="button"
          className="underline font-semibold text-body"
          onClick={() => go("company")}
        >
          Register your company
        </button>
      </p>
    </form>
  );
}
