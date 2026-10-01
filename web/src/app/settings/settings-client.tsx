"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { applyTheme } from "@/lib/theme";
import type { Viewer } from "@/lib/api-auth";
import {
  signOut as endSession,
  type ViewerSession,
} from "@/lib/session-client";

export default function SettingsClient({ initialViewer }: { initialViewer: Viewer }) {
  const [viewer, setViewer] = useState<ViewerSession | null>(() =>
    initialViewer.kind === "anon"
      ? null
      : initialViewer.kind === "hr"
        ? { kind: "hr", email: initialViewer.email, name: initialViewer.name, isAdmin: initialViewer.isAdmin }
        : { kind: "owner", email: initialViewer.email },
  );
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const root = document.documentElement;
    const read = () =>
      setTheme(root.getAttribute("data-theme") === "dark" ? "dark" : "light");
    read();
    const obs = new MutationObserver(read);
    obs.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  const signOut = async () => {
    await endSession();
    setViewer(null);
  };

  return (
    <div
      className="rise grid max-w-xl gap-5 mx-auto"
      style={{ "--d": "60ms" } as React.CSSProperties}
    >
      <section className="rounded-2xl bg-surface shadow-soft-md p-7 sm:p-9">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
          Account
        </p>
        {viewer ? (
          <>
            <h2 className="mt-3 text-[20px] font-semibold tracking-[-0.01em] text-ink">
              Signed in as {viewer.name ?? viewer.email}
            </h2>
            <p className="mt-2 text-[15px] leading-[1.6] text-body">
              {viewer.name ? `${viewer.email} - ` : ""}
              {viewer.kind === "hr"
                ? "Employer session on this device."
                : "Candidate page session."}
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link
                href={viewer.kind === "hr" ? "/hire/login" : "/join"}
                className="btn btn-primary press"
              >
                {viewer.kind === "hr" ? "Manage session" : "Edit my page"}{" "}
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <button
                type="button"
                className="btn btn-secondary press"
                onClick={() => void signOut()}
              >
                Log out
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="mt-3 text-[20px] font-semibold tracking-[-0.01em] text-ink">
              Not signed in
            </h2>
            <p className="mt-2 text-[15px] leading-[1.6] text-body">
              Pick a path - build your candidate page or open an employer session.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link href="/join" className="btn btn-primary press">
                Get hired <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <Link href="/hire/login" className="btn btn-secondary press">
                Hiring someone
              </Link>
            </div>
          </>
        )}
      </section>

      <section className="rounded-2xl bg-surface shadow-soft-md p-7 sm:p-9">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
          Appearance
        </p>
        <h2 className="mt-3 text-[20px] font-semibold tracking-[-0.01em] text-ink">
          Theme
        </h2>
        <p className="mt-2 text-[15px] leading-[1.6] text-body">
          Light or dark - applies across the app.
        </p>
        <div className="seg mt-5" role="group" aria-label="Theme">
          <button
            type="button"
            className={`seg-btn${theme === "light" ? " is-on" : ""}`}
            aria-pressed={theme === "light"}
            onClick={() => applyTheme("light")}
          >
            Light
          </button>
          <button
            type="button"
            className={`seg-btn${theme === "dark" ? " is-on" : ""}`}
            aria-pressed={theme === "dark"}
            onClick={() => applyTheme("dark")}
          >
            Dark
          </button>
        </div>
      </section>
    </div>
  );
}
