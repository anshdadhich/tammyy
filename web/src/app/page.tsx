import Link from "next/link";
import PageShell from "@/components/PageShell";
import { FaqList, HeroDemo } from "@/app/landing-interactives";

const PIPELINE = [
  {
    n: "01",
    title: "Filter",
    desc: "Hard constraints, availability, and compensation requirements.",
    fill: "88%",
  },
  {
    n: "02",
    title: "Vectors",
    desc: "Every meaningful project chunk becomes semantically searchable.",
    fill: "74%",
  },
  {
    n: "03",
    title: "Score",
    desc: "Depth of technical contribution and evidence credibility.",
    fill: "91%",
  },
  {
    n: "04",
    title: "Judge",
    desc: "Evaluates fit, flags gaps, and calibrates interview questions.",
    fill: "82%",
  },
];

const DISCOVERY_STEPS = [
  {
    n: "01",
    title: "Describe",
    desc: '"Senior backend engineer who has shipped distributed systems."',
  },
  {
    n: "02",
    title: "Search",
    desc: "Relevant experience and project chunks are retrieved.",
  },
  {
    n: "03",
    title: "Evaluate",
    desc: "Evidence depth and verified metrics shape candidate ranking.",
  },
  {
    n: "04",
    title: "Understand",
    desc: "Verdicts, exhibits, gaps, and calibrated questions.",
  },
  {
    n: "05",
    title: "Contact",
    desc: "Reach out directly with full audit-logging on both sides.",
  },
];

const CONTROL_CARDS = [
  {
    glyph: "◇",
    title: "Private by design",
    desc: "No public candidate directory. Employers are verified before they can discover talent.",
  },
  {
    glyph: "◌",
    title: "Candidate control",
    desc: "Candidates control visibility, portfolio links, and can delete or export their profile at any time.",
  },
  {
    glyph: "✓",
    title: "Accountable contact",
    desc: "Contact is direct for speed, while every profile view and inquiry is transparently audit-logged.",
  },
];

const DOSSIER_SKILLS = ["Python", "Distributed Systems", "Kubernetes", "PostgreSQL"];

export default async function HomePage() {
  return (
    <PageShell variant="landing" active="/#candidates" footer>
      <section id="top" className="relative pt-20 lg:pt-28 pb-24 overflow-hidden">
        <div className="max-w-[1160px] mx-auto px-6">
          <h1
            className="rise text-[clamp(2.5rem,5.6vw,4.25rem)] font-semibold tracking-[-0.03em] leading-[1.05] text-ink"
            style={{ "--d": "60ms" } as React.CSSProperties}
          >
            Candidates don&apos;t apply.
            <br />
            Employers discover them.
          </h1>

          <div
            className="rise flex flex-wrap items-center gap-3 mt-8"
            style={{ "--d": "160ms" } as React.CSSProperties}
          >
            <span style={{ display: "inline-block", borderRadius: "999px" }}>
              <Link href="/join" className="btn btn-primary">
                Build my page
              </Link>
            </span>
            <Link href="/hire/login" className="btn btn-secondary press">
              I&apos;m hiring{" "}
              <svg
                className="w-4 h-4"
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
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </svg>
            </Link>
          </div>

          <HeroDemo />
        </div>
      </section>

      <section className="py-24">
        <div className="max-w-[1160px] mx-auto px-6">
          <div className="mb-10 lg:mb-14">
            <h2 className="text-[clamp(1.75rem,3.2vw,2.5rem)] font-semibold tracking-[-0.02em] leading-[1.12] text-ink">
              Hiring is backwards.
            </h2>
            <p className="text-[17px] leading-[1.6] text-muted max-w-[560px] mt-4">
              Candidates repeatedly rewrite the same story for hundreds of applications. Employers
              receive stacks of resumes optimized for keywords, not evidence.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="rounded-2xl bg-surface p-7 shadow-soft-md">
              <div className="text-xs font-semibold text-muted mb-3">Candidate</div>
              <h3 className="text-xl font-semibold tracking-[-0.01em] text-ink mb-3">
                Apply. Rewrite. Repeat.
              </h3>
              <p className="text-[15px] text-body leading-relaxed">
                The strongest candidates spend their time formatting applications instead of
                building. Every company asks for the same information in a slightly different box.
              </p>

              <div className="mt-6 flex flex-col gap-2">
                <div className="h-10 rounded-xl bg-inset flex items-center justify-between px-3 text-[13px] text-body">
                  <span>Application #142 · Staff Engineer</span>
                  <span className="text-muted font-mono text-[11px]">Awaiting review</span>
                </div>
                <div className="h-10 rounded-xl bg-inset flex items-center justify-between px-3 text-[13px] text-body">
                  <span>Application #141 · Systems Engineer</span>
                  <span className="text-warn font-mono text-[11px] font-medium">Filtered</span>
                </div>
                <div className="h-10 rounded-xl bg-inset flex items-center justify-between px-3 text-[13px] text-body">
                  <span>Application #140 · Backend Lead</span>
                  <span className="text-muted font-mono text-[11px]">Unread</span>
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-brand-soft border border-brand-line p-7 shadow-soft-md">
              <div className="text-xs font-semibold text-brand-text mb-3">Tammy</div>
              <h3 className="text-xl font-semibold tracking-[-0.01em] text-ink mb-3">
                Prove it once.
              </h3>
              <p className="text-[15px] text-body leading-relaxed">
                Candidates create one evidence-backed profile. Tammy turns projects, experience, and
                proof into a structured talent signal employers can search.
              </p>

              <div className="flex flex-wrap gap-2 mt-6">
                <span className="text-[11px] font-mono uppercase tracking-wide px-2.5 py-1 rounded-full bg-surface border border-line text-muted">Experience</span>
                <span className="text-[11px] font-mono uppercase tracking-wide px-2.5 py-1 rounded-full bg-surface border border-line text-muted">Projects</span>
                <span className="text-[11px] font-mono uppercase tracking-wide px-2.5 py-1 rounded-full bg-brand text-on-brand border border-transparent">Proof</span>
                <span className="text-[11px] font-mono uppercase tracking-wide px-2.5 py-1 rounded-full bg-surface border border-line text-muted">Terms</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="candidates" className="py-24">
        <div className="max-w-[1160px] mx-auto px-6">
          <div className="mb-10 lg:mb-14">
            <h2 className="text-[clamp(1.75rem,3.2vw,2.5rem)] font-semibold tracking-[-0.02em] leading-[1.12] text-ink">
              Build your talent record once.
            </h2>
            <p className="text-[17px] leading-[1.6] text-muted max-w-[560px] mt-4">
              Four steps. Autosaved drafts. Real evidence. Your resume stays in your hands. Review
              everything before your profile becomes discoverable.
            </p>
          </div>

          <div className="grid md:grid-cols-[240px_1fr] rounded-2xl bg-surface overflow-hidden shadow-soft-md">
            <div className="p-6 bg-inset">
              <div className="text-sm font-semibold text-ink mb-1">Your profile</div>
              <div className="text-[13px] text-muted mb-6 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-success" /> Saved automatically
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-sm text-muted">
                  <span className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-mono bg-surface border border-line text-muted">
                    1
                  </span>
                  <span>Basics</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted">
                  <span className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-mono bg-surface border border-line text-muted">
                    2
                  </span>
                  <span>Profile &amp; skills</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-ink font-semibold">
                  <span className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-mono bg-brand text-on-brand shadow-soft-sm">
                    3
                  </span>
                  <span>Proof</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted">
                  <span className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-mono bg-surface border border-line text-muted">
                    4
                  </span>
                  <span>Resume &amp; terms</span>
                </div>
              </div>
            </div>

            <div className="p-6">
              <h3 className="text-base font-semibold text-ink mb-1">Show what you built.</h3>
              <p className="text-[13px] text-muted mb-5">Evidence makes the profile useful.</p>

              <div className="grid grid-cols-2 gap-3">
                <div className="border border-line rounded-xl p-3 bg-inset">
                  <div className="text-[10px] font-mono text-muted uppercase mb-1">Project</div>
                  <div className="text-[13px] font-semibold text-ink">Distributed inference service</div>
                </div>
                <div className="border border-line rounded-xl p-3 bg-inset">
                  <div className="text-[10px] font-mono text-muted uppercase mb-1">Role</div>
                  <div className="text-[13px] font-semibold text-ink">Lead Engineer</div>
                </div>
                <div className="col-span-2 border border-line rounded-xl p-3 bg-inset">
                  <div className="text-[10px] font-mono text-muted uppercase mb-1">
                    What did you actually do?
                  </div>
                  <div className="text-[13px] font-semibold text-ink">
                    Reduced inference latency by 41% across production workloads.
                  </div>
                </div>
                <div className="border border-line rounded-xl p-3 bg-inset">
                  <div className="text-[10px] font-mono text-muted uppercase mb-1">Evidence</div>
                  <div className="text-[13px] font-semibold text-ink">GitHub · Benchmarks</div>
                </div>
                <div className="border border-line rounded-xl p-3 bg-inset">
                  <div className="text-[10px] font-mono text-muted uppercase mb-1">Impact</div>
                  <div className="text-[13px] font-semibold text-ink">41% faster throughput</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="engine" className="py-24">
        <div className="max-w-[1160px] mx-auto px-6">
          <div className="mb-10 lg:mb-14">
            <h2 className="text-[clamp(1.75rem,3.2vw,2.5rem)] font-semibold tracking-[-0.02em] leading-[1.12] text-ink">
              The pipeline reads like a hiring manager.
            </h2>
            <p className="text-[17px] leading-[1.6] text-muted max-w-[560px] mt-4">
              Tammy doesn&apos;t turn candidates into mysterious AI scores. It builds a factual,
              evidence-linked representation of the work behind the resume.
            </p>
          </div>

          <div className="rounded-2xl bg-surface p-6 sm:p-7 shadow-soft-md">
            <div className="flex flex-wrap justify-between items-center gap-3 pb-5 border-b border-line mb-5">
              <div>
                <div className="text-[10px] font-mono text-muted uppercase">Live search trace</div>
                <div className="text-sm font-semibold text-ink mt-1">
                  Backend engineer · distributed systems
                </div>
              </div>
              <span className="text-[11px] font-mono px-2.5 py-1 rounded-full bg-success-soft text-success flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-success" /> 30 candidates found
              </span>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {PIPELINE.map((p) => (
                <div key={p.n} className="p-2">
                  <span className="text-[11px] font-mono font-semibold text-brand-text">{p.n}</span>
                  <h3 className="text-[15px] font-semibold text-ink mt-1.5 mb-1">{p.title}</h3>
                  <p className="text-[13px] text-muted leading-relaxed">{p.desc}</p>
                  <div className="flex justify-end mt-3">
                    <span className="text-[13px] font-semibold text-ink">{p.fill}</span>
                  </div>
                  <div className="trace-rule" aria-hidden="true">
                    <div
                      className="trace-fill"
                      style={{ width: p.fill, background: "var(--brand)" }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="py-24">
        <div className="max-w-[1160px] mx-auto px-6">
          <div className="mb-10 lg:mb-14">
            <h2 className="text-[clamp(1.75rem,3.2vw,2.5rem)] font-semibold tracking-[-0.02em] leading-[1.12] text-ink">
              Describe the person. Don&apos;t write a Boolean query.
            </h2>
            <p className="text-[17px] leading-[1.6] text-muted max-w-[560px] mt-4">
              An employer describes the role in natural language. Tammy searches structured
              experience, project evidence, and semantic representations.
            </p>
          </div>

          <div
            role="list"
            data-slot="stepper"
            data-orientation="vertical"
            className="group/stepper inline-flex data-[orientation=horizontal]:w-full data-[orientation=horizontal]:flex-row data-[orientation=vertical]:flex-col !grid w-full grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-5"
          >
            {DISCOVERY_STEPS.map((s) => (
              <div
                key={s.n}
                role="listitem"
                data-slot="stepper-item"
                data-state="inactive"
                className="group/step flex items-center group-data-[orientation=horizontal]/stepper:flex-row group-data-[orientation=vertical]/stepper:flex-col relative isolate min-w-0 overflow-hidden rounded-2xl border border-line bg-inset p-5 !items-start"
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-2 -top-3 -z-10 select-none font-mono text-[64px] font-semibold leading-none tracking-[-0.04em] text-brand-text opacity-10"
                >
                  {s.n}
                </span>
                <span
                  data-slot="stepper-indicator"
                  data-state="inactive"
                  className="bg-brand text-on-brand data-[state=active]:bg-brand data-[state=completed]:bg-brand relative flex size-8 shrink-0 items-center justify-center rounded-full font-mono text-[11.5px] font-semibold leading-none"
                >
                  {s.n}
                </span>
                <h3 data-slot="stepper-title" className="text-[15px] font-semibold text-ink mt-4">
                  {s.title}
                </h3>
                <p
                  data-slot="stepper-description"
                  className="text-[13.5px] leading-relaxed text-muted mt-1.5"
                >
                  {s.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24">
        <div className="max-w-[1160px] mx-auto px-6">
          <div className="mb-10 lg:mb-14">
            <h2 className="text-[clamp(1.75rem,3.2vw,2.5rem)] font-semibold tracking-[-0.02em] leading-[1.12] text-ink">
              Not another resume. A candidate dossier.
            </h2>
            <p className="text-[17px] leading-[1.6] text-muted max-w-[560px] mt-4">
              The result gives a hiring manager enough context to decide whether a conversation is
              worth having-without pretending the system knows more than the evidence says.
              Illustrative example below; live dossiers render from real profiles.
            </p>
          </div>

          <div className="grid md:grid-cols-[280px_1fr] rounded-2xl bg-surface overflow-hidden shadow-soft-md">
            <div className="p-6 bg-inset">
              <div className="w-10 h-10 rounded-xl bg-brand text-on-brand font-semibold text-sm flex items-center justify-center mb-3 shadow-soft-sm">
                AK
              </div>
              <div className="text-[17px] font-semibold text-ink">Alex Kim</div>
              <div className="text-[13px] text-muted mt-0.5">Backend · Infrastructure · AI</div>

              <div className="flex flex-wrap gap-1.5 mt-5">
                {DOSSIER_SKILLS.map((s) => (
                  <span
                    key={s}
                    className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-surface border border-line text-muted"
                  >
                    {s}
                  </span>
                ))}
              </div>

              <div className="mt-5 pt-4 border-t border-line">
                <div className="text-[10px] font-mono text-muted uppercase">Availability</div>
                <div className="text-[13px] font-semibold text-ink mt-1 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-success" /> 30 days · Remote
                </div>
              </div>
            </div>

            <div className="p-6 flex flex-col gap-3">
              <div className="rounded-xl p-4 bg-inset">
                <div className="flex justify-between items-center mb-2 gap-3">
                  <span className="text-[13px] font-semibold text-ink">
                    Distributed inference service
                  </span>
                  <span className="text-[10px] font-mono font-medium text-muted bg-surface px-2 py-0.5 rounded-full border border-line shrink-0">
                    PROJECT
                  </span>
                </div>
                <p className="text-[13px] text-body leading-relaxed">
                  Designed and shipped a production inference layer handling high-volume model
                  requests with 41% latency reduction.
                </p>
              </div>

              <div className="rounded-xl p-4 bg-inset">
                <div className="flex justify-between items-center mb-2 gap-3">
                  <span className="text-[13px] font-semibold text-ink">Why this candidate</span>
                  <span className="text-[10px] font-mono font-medium text-brand-text bg-brand-soft px-2 py-0.5 rounded-full shrink-0">
                    JUDGE
                  </span>
                </div>
                <p className="text-[13px] text-body leading-relaxed">
                  Strong overlap with distributed systems requirements. Evidence supports production
                  ownership. Limited evidence of people management.
                </p>
              </div>

              <div className="rounded-xl p-4 bg-inset">
                <div className="flex justify-between items-center mb-2 gap-3">
                  <span className="text-[13px] font-semibold text-ink">
                    Suggested interview questions
                  </span>
                  <span className="text-[10px] font-mono font-medium text-muted bg-surface px-2 py-0.5 rounded-full border border-line shrink-0">
                    NEXT
                  </span>
                </div>
                <p className="text-[13px] text-body leading-relaxed">
                  Ask how the inference architecture handled failure recovery and how the latency
                  improvement was measured.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-24">
        <div className="max-w-[1160px] mx-auto px-6">
          <div className="mb-10 lg:mb-14">
            <h2 className="text-[clamp(1.75rem,3.2vw,2.5rem)] font-semibold tracking-[-0.02em] leading-[1.12] text-ink">
              Discovery without giving up control.
            </h2>
            <p className="text-[17px] leading-[1.6] text-muted max-w-[560px] mt-4">
              Talent discovery only works if candidates trust the system. Privacy, control, and
              accountability are part of the product.
            </p>
          </div>

          <div className="grid md:grid-cols-3 rounded-2xl bg-surface overflow-hidden shadow-soft-md">
            {CONTROL_CARDS.map((c) => (
              <div
                key={c.title}
                className="p-6 border-t border-line first:border-t-0 md:border-t-0 md:border-l md:first:border-l-0"
              >
                <div
                  className="w-9 h-9 rounded-xl bg-brand-soft text-brand-text grid place-items-center text-[15px] mb-4"
                  aria-hidden="true"
                >
                  {c.glyph}
                </div>
                <h3 className="text-[15px] font-semibold text-ink mb-2">{c.title}</h3>
                <p className="text-[14px] text-muted leading-relaxed">{c.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="faq" className="py-24">
        <div className="max-w-[920px] mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-10">
            <h2 className="text-[clamp(1.75rem,3.2vw,2.5rem)] font-semibold tracking-[-0.02em] leading-[1.12] text-ink">
              Frequently asked questions.
            </h2>
            <p className="text-[17px] leading-[1.6] text-muted max-w-xl mx-auto mt-4">
              Everything you need to know about the reverse discovery model, privacy guarantees, and
              evaluation pipeline.
            </p>
          </div>

          <FaqList />
        </div>
      </section>
    </PageShell>
  );
}
