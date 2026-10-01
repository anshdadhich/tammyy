import type { Metadata } from "next";
import { redirect } from "next/navigation";
import DitherCanvas from "@/components/DitherCanvas";
import PageShell from "@/components/PageShell";
import { readHrSession } from "@/lib/hr-session";
import LoginForm from "./login-form";

export const metadata: Metadata = {
  title: "Employer login",
  description:
    "Open an employer session on this device - then search the pool, shortlists, and see contact channels.",
};

export default async function HireLoginPage() {
  const hr = await readHrSession();
  if (hr && (hr.isAdmin || hr.employerStatus !== "none")) redirect("/hire/search");

  return (
    <PageShell variant="hire" active="/hire">
      <section className="relative overflow-hidden pt-14 pb-24 lg:pt-20">
        <div className="bg-dither" aria-hidden="true">
          <DitherCanvas />
        </div>
        <div className="relative max-w-[1160px] mx-auto px-6">
          <div
            className="rise mx-auto w-full max-w-xl rounded-2xl bg-surface shadow-soft-md p-7 sm:p-9"
            style={{ "--d": "80ms" } as React.CSSProperties}
          >
            <p className="flex items-center gap-2.5 font-mono text-[12.5px] font-medium text-brand-text">
              <span
                aria-hidden="true"
                className="inline-block h-[2px] w-6"
                style={{ background: "var(--brand)" }}
              />
              Hire login
            </p>
            <h1 className="mt-4 text-[clamp(1.9rem,3.4vw,2.5rem)] font-semibold tracking-[-0.02em] leading-[1.08] text-ink">
              First, your login.
            </h1>
            <p className="mt-3 text-[15.5px] leading-[1.6] text-muted">
              Sign in with your email and password. Search, shortlists, and contact channels unlock
              on this device once your company is verified.
            </p>
            <div className="mt-6">
              <LoginForm initialStage={hr ? "company" : "signin"} />
            </div>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
