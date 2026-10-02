"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toggleTheme } from "@/lib/theme";
import type { HrSession, ViewerSession } from "@/lib/hr-session";

type Props = {
  viewer: ViewerSession;
  hr: HrSession | null;
};

export default function SettingsClient({ viewer, hr }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"light" | "dark">("light");

  useEffect(() => {
    const sync = () => {
      setMode(document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");
    };
    const id = setTimeout(sync, 0);
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => {
      clearTimeout(id);
      observer.disconnect();
    };
  }, []);

  async function onLogout(): Promise<void> {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Something went wrong");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setPending(false);
    }
  }

  function pick(next: "light" | "dark") {
    if (document.documentElement.getAttribute("data-theme") === next) return;
    toggleTheme();
  }

  const sessionLine = hr
    ? `${viewer.email} - Employer session on this device.`
    : `${viewer.email} - Candidate session on this device.`;

  return (
    <div className="rise grid max-w-xl gap-5 mx-auto" style={{ "--d": "60ms" } as React.CSSProperties}>
      <section className="rounded-2xl bg-surface shadow-soft-md p-7 sm:p-9">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Account</p>
        <h2 className="mt-3 text-[20px] font-semibold tracking-[-0.01em] text-ink">
          Signed in as {viewer.name ?? viewer.email}
        </h2>
        <p className="mt-2 text-[15px] leading-[1.6] text-body">{sessionLine}</p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link href="/hire/login" className="btn btn-primary press">
            Manage session{" "}
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </Link>
          <button type="button" className="btn btn-secondary press" disabled={pending} onClick={() => void onLogout()}>
            {pending ? "Logging out…" : "Log out"}
          </button>
        </div>
        <div aria-live="polite">
          {error && <p className="field-error mt-3">{error}</p>}
        </div>
      </section>
      <section className="rounded-2xl bg-surface shadow-soft-md p-7 sm:p-9">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Appearance</p>
        <h2 className="mt-3 text-[20px] font-semibold tracking-[-0.01em] text-ink">Theme</h2>
        <p className="mt-2 text-[15px] leading-[1.6] text-body">Light or dark - applies across the app.</p>
        <div className="seg mt-5" role="group" aria-label="Theme">
          <button
            type="button"
            className={mode === "light" ? "seg-btn is-on" : "seg-btn"}
            aria-pressed={mode === "light"}
            onClick={() => pick("light")}
          >
            Light
          </button>
          <button
            type="button"
            className={mode === "dark" ? "seg-btn is-on" : "seg-btn"}
            aria-pressed={mode === "dark"}
            onClick={() => pick("dark")}
          >
            Dark
          </button>
        </div>
      </section>
    </div>
  );
}
