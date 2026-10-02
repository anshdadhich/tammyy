import SectionReveals from "@/components/SectionReveals";
import type { Metadata } from "next";
import Link from "next/link";
import PageShell from "@/components/PageShell";
import TraceFill from "@/components/TraceFill";
import BeamCta from "@/components/BeamCta";

export const metadata: Metadata = {
  title: "For employers",
  description:
    "Describe the hire, read the scored shortlist, judge the finalists with Deep Read, and reach out with the contact logged.",
};

const searchIcon = (
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
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.34-4.34" />
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

export default async function HirePage() {
  return (
    <PageShell variant="hire" active="/hire">
      <SectionReveals />
      <section className="pt-20 lg:pt-28 pb-16" data-reveal-section>
        <div className="max-w-[1160px] mx-auto px-6">
          <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div>
              <h1
                className="rise text-[clamp(2.5rem,5.6vw,4.25rem)] font-semibold tracking-[-0.03em] leading-[1.05] text-ink"
                style={{ "--d": "60ms" } as React.CSSProperties}
              >
                Describe the person you need.
              </h1>
              <p
                className="rise mt-6 text-[17px] leading-[1.6] text-muted max-w-[540px]"
                style={{ "--d": "160ms" } as React.CSSProperties}
              >
                No Boolean strings, no resume keyword lottery. Write the brief the way you&apos;d
                write it for a teammate, read the evidence each match is scored on, and let Deep Read
                judge the finalists.
              </p>
              <div
                className="rise flex flex-wrap items-center gap-3 mt-8"
                style={{ "--d": "160ms" } as React.CSSProperties}
              >
                <span style={{ display: "inline-block", borderRadius: "999px" }}>
                  <BeamCta><Link href="/hire/search" className="btn btn-primary press">
                    {searchIcon} Start a search
                  </Link></BeamCta>
                </span>
                <Link href="/hire/login" className="btn btn-secondary press">
                  Employer login {arrowIcon}
                </Link>
              </div>
            </div>

            <div className="rise" style={{ "--d": "280ms" } as React.CSSProperties} aria-hidden="true">
              <div className="rounded-2xl bg-surface shadow-soft-md p-6">
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                  Your brief
                </p>
                <p className="mt-2 text-[15px] leading-[1.55] text-ink font-medium">
                  Senior React engineer - someone who has shipped design systems, not just used
                  them.
                </p>
                <div className="mt-5 pt-4 border-t border-line grid gap-4">
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="grid place-items-center w-7 h-7 rounded-full bg-brand-soft text-brand-text text-[11px] font-semibold flex-none">
                          MK
                        </span>
                        <span className="text-[13.5px] text-body truncate">
                          Frontend engineer · 7 yrs · Bengaluru
                        </span>
                      </div>
                      <span className="text-[15px] font-semibold text-ink score-num flex-none">
                        84
                      </span>
                    </div>
                    <div className="trace-rule" aria-hidden="true">
                      <TraceFill width="84%" background="#1F2DE6" />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="grid place-items-center w-7 h-7 rounded-full bg-brand-soft text-brand-text text-[11px] font-semibold flex-none">
                          AV
                        </span>
                        <span className="text-[13.5px] text-body truncate">
                          Design systems lead · 9 yrs · Remote
                        </span>
                      </div>
                      <span className="text-[15px] font-semibold text-ink score-num flex-none">
                        76
                      </span>
                    </div>
                    <div className="trace-rule" aria-hidden="true">
                      <TraceFill width="76%" background="#1F2DE6" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-14" data-reveal-section>
        <div className="max-w-[1160px] mx-auto px-6">
          <h2 className="text-[clamp(1.75rem,3.2vw,2.5rem)] font-semibold tracking-[-0.02em] leading-[1.12] text-ink">
            How a search runs.
          </h2>
          <div className="grid gap-5 sm:grid-cols-2 mt-8">
            <div className="rounded-2xl bg-surface shadow-soft-md p-6">
              <div className="flex items-center gap-2.5">
                <span
                  className="w-2 h-2 rounded-full flex-none"
                  style={{ background: "var(--brand)" }}
                  aria-hidden="true"
                />
                <h3 className="text-[15.5px] font-semibold text-ink tracking-[-0.01em]">
                  Write the brief
                </h3>
              </div>
              <p className="mt-3 text-[14.5px] leading-[1.6] text-body">
                Title, must-haves, constraints - the same five minutes you&apos;d spend briefing a
                recruiter, in plain sentences.
              </p>
            </div>
            <div className="rounded-2xl bg-surface shadow-soft-md p-6">
              <div className="flex items-center gap-2.5">
                <span
                  className="w-2 h-2 rounded-full flex-none"
                  style={{ background: "var(--brand)" }}
                  aria-hidden="true"
                />
                <h3 className="text-[15.5px] font-semibold text-ink tracking-[-0.01em]">
                  Read the shortlist
                </h3>
              </div>
              <p className="mt-3 text-[14.5px] leading-[1.6] text-body">
                Every candidate arrives with one score split five ways, plus the skills and projects
                that produced it.
              </p>
            </div>
            <div className="rounded-2xl bg-surface shadow-soft-md p-6">
              <div className="flex items-center gap-2.5">
                <span
                  className="w-2 h-2 rounded-full flex-none"
                  style={{ background: "var(--brand)" }}
                  aria-hidden="true"
                />
                <h3 className="text-[15.5px] font-semibold text-ink tracking-[-0.01em]">
                  Judge the finalists
                </h3>
              </div>
              <p className="mt-3 text-[14.5px] leading-[1.6] text-body">
                Deep Read runs the top matches through a judge that marks gaps, risks, and the
                questions worth asking.
              </p>
            </div>
            <div className="rounded-2xl bg-surface shadow-soft-md p-6">
              <div className="flex items-center gap-2.5">
                <span
                  className="w-2 h-2 rounded-full flex-none"
                  style={{ background: "var(--brand)" }}
                  aria-hidden="true"
                />
                <h3 className="text-[15.5px] font-semibold text-ink tracking-[-0.01em]">
                  Reach out on the record
                </h3>
              </div>
              <p className="mt-3 text-[14.5px] leading-[1.6] text-body">
                Shortlists and contacts are logged, so accountability doesn&apos;t evaporate after
                the hire.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="py-14" data-reveal-section>
        <div className="max-w-[1160px] mx-auto px-6">
          <div className="rounded-2xl bg-surface shadow-soft-md p-7 sm:p-10 grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <h2 className="text-[clamp(1.75rem,3.2vw,2.5rem)] font-semibold tracking-[-0.02em] leading-[1.12] text-ink">
                What a score is made of.
              </h2>
              <p className="mt-4 text-[15.5px] leading-[1.6] text-body max-w-[46ch]">
                Five parts, fixed weights, every part visible in the results. When someone ranks, you
                can see which dimension carried them - and which one didn&apos;t.
              </p>
            </div>
            <div className="grid gap-5">
              <div>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-[14.5px] font-medium text-ink">Semantic fit</span>
                  <span className="font-mono text-[13px] text-muted">25%</span>
                </div>
                <div className="trace-rule" aria-hidden="true">
                  <TraceFill width="25%" background="#1F2DE6" />
                </div>
              </div>
              <div>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-[14.5px] font-medium text-ink">Skill evidence</span>
                  <span className="font-mono text-[13px] text-muted">25%</span>
                </div>
                <div className="trace-rule" aria-hidden="true">
                  <TraceFill width="25%" background="#1F2DE6" />
                </div>
              </div>
              <div>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-[14.5px] font-medium text-ink">Project depth</span>
                  <span className="font-mono text-[13px] text-muted">20%</span>
                </div>
                <div className="trace-rule" aria-hidden="true">
                  <TraceFill width="20%" background="#1F2DE6" />
                </div>
              </div>
              <div>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-[14.5px] font-medium text-ink">Constraints</span>
                  <span className="font-mono text-[13px] text-muted">15%</span>
                </div>
                <div className="trace-rule" aria-hidden="true">
                  <TraceFill width="15%" background="#1F2DE6" />
                </div>
              </div>
              <div>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-[14.5px] font-medium text-ink">Seniority</span>
                  <span className="font-mono text-[13px] text-muted">10%</span>
                </div>
                <div className="trace-rule" aria-hidden="true">
                  <TraceFill width="10%" background="#1F2DE6" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-14 pb-24" data-reveal-section>
        <div className="max-w-[1160px] mx-auto px-6">
          <div className="rounded-2xl bg-surface shadow-soft-md p-8 sm:p-12 text-center">
            <h2 className="text-[clamp(1.75rem,3.2vw,2.5rem)] font-semibold tracking-[-0.02em] text-ink">
              Describe your first hire.
            </h2>
            <p className="mt-4 text-[15.5px] leading-[1.6] text-muted max-w-[52ch] mx-auto">
              Search runs behind an employer session - one email on this device opens it. Then
              it&apos;s a brief away.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 mt-7">
              <span style={{ display: "inline-block", borderRadius: "999px" }}>
                <BeamCta><Link href="/hire/search" className="btn btn-primary press">
                  Start a search {arrowIcon}
                </Link></BeamCta>
              </span>
              <Link href="/hire/login" className="btn btn-secondary press">
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
