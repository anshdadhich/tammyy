"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import DitherCanvas from "@/components/DitherCanvas";

const CHECKLIST_STEPS = [
  "Parse brief",
  "Embed query",
  "Hybrid retrieval",
  "Score 5 dimensions",
  "Deep Read judge",
  "Unlock contact",
];

type StepStatus = "done" | "running" | "queued";

const INITIAL_STATUSES: StepStatus[] = [
  "done",
  "done",
  "done",
  "running",
  "queued",
  "queued",
];

const MATCH_COPY = {
  describe: {
    title: "Describe the role, not a query.",
    desc: "Write how you'd brief a teammate - stack, scope, constraints, and seniority. No Boolean gymnastics. Tammy parses intent, not keywords, and surfaces evidence that matches meaning.",
  },
  search: {
    title: "It explains every score.",
    desc: "Semantic fit, skill evidence, project depth, constraints and seniority - each weighed from what people actually built, not what they claimed. Every value is real and inspectable, so what lands is a shortlist, not a guess.",
  },
  deep: {
    title: "Deep Read judges the evidence.",
    desc: "For the top profiles, the judge reads full context - written exhibits, gaps, and risks - then calibrates interview questions. Slower, sharper, and audit-logged so hiring stays accountable.",
  },
} as const;

type MatchMode = keyof typeof MATCH_COPY;

const MATCH_MODES: { key: MatchMode; label: string }[] = [
  { key: "describe", label: "Describe role" },
  { key: "search", label: "Search" },
  { key: "deep", label: "Deep Read" },
];

export function HeroDemo() {
  const [mode, setMode] = useState<MatchMode>("search");
  const [statuses, setStatuses] = useState<StepStatus[]>(INITIAL_STATUSES);
  const runningRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const rotateRef = useRef<number | null>(null);
  const pauseTicksRef = useRef(0);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      if (rotateRef.current !== null) window.clearInterval(rotateRef.current);
    };
  }, []);


  // Auto-rotate the hero mode every 4.5s unless the visitor took over
  // recently (3 idle ticks ≈ 13s), the tab is hidden, or motion is reduced.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    rotateRef.current = window.setInterval(() => {
      if (document.hidden) return;
      if (pauseTicksRef.current > 0) {
        pauseTicksRef.current -= 1;
        return;
      }
      setMode((cur) => {
        const idx = MATCH_MODES.findIndex((m) => m.key === cur);
        return MATCH_MODES[(idx + 1) % MATCH_MODES.length].key;
      });
    }, 4500);
    return () => {
      if (rotateRef.current !== null) window.clearInterval(rotateRef.current);
      rotateRef.current = null;
    };
  }, []);

  function runChecklist() {
    if (runningRef.current) return;
    runningRef.current = true;
    setStatuses(CHECKLIST_STEPS.map(() => "queued" as StepStatus));
    let i = 0;
    timerRef.current = window.setInterval(() => {
      i += 1;
      setStatuses(
        CHECKLIST_STEPS.map((_, j): StepStatus =>
          j < i ? "done" : j === i ? "running" : "queued"
        )
      );
      if (i >= CHECKLIST_STEPS.length) {
        if (timerRef.current !== null) window.clearInterval(timerRef.current);
        timerRef.current = null;
        runningRef.current = false;
      }
    }, 380);
  }

  function selectMode(next: MatchMode) {
    pauseTicksRef.current = 3;
    setMode(next);
    if (next === "search") runChecklist();
  }

  function runQuery() {
    pauseTicksRef.current = 3;
    setMode("search");
    runChecklist();
  }

  return (
    <div className="rise mt-14 lg:mt-16" style={{ "--d": "280ms" } as React.CSSProperties}>
      <div className="grid lg:grid-cols-5 gap-10 lg:gap-14 items-start">
        <div className="lg:col-span-3 relative">
          <div className="relative rounded-[28px] bg-brand p-8 sm:p-12 overflow-hidden shadow-soft-lg">
            <div className="absolute inset-0" aria-hidden="true">
              <DitherCanvas />
            </div>

            <div className="relative rounded-2xl bg-surface shadow-soft-md px-6 py-6 sm:px-8 sm:py-7">
              <div className="flex items-center justify-between text-[11px] text-muted mb-4 font-mono">
                <span>MATCHING YOUR BRIEF</span>
                <span className="text-brand-text flex items-center gap-1.5 font-sans font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand pulse-dot" /> Active query
                </span>
              </div>
              <div className="space-y-3">
                {CHECKLIST_STEPS.map((label, i) => {
                  const status = statuses[i];
                  return (
                    <div key={label} className="flex items-center justify-between">
                      <span
                        className={
                          status === "queued"
                            ? "flex items-center gap-2.5 text-[13px] text-muted"
                            : "flex items-center gap-2.5 text-[13px] text-ink"
                        }
                      >
                        {status === "done" ? (
                          <svg
                            className="w-3.5 h-3.5 text-brand-text"
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
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                        ) : status === "running" ? (
                          <span className="w-2 h-2 rounded-full bg-brand pulse-dot inline-block" />
                        ) : (
                          <span className="w-2 h-2 rounded-full border border-line inline-block" />
                        )}
                        {label}
                      </span>
                      <span
                        className={`font-mono text-[11px] ${status === "running" ? "text-brand-text" : "text-muted"}`}
                      >
                        {status === "done" ? "done" : status === "running" ? "running…" : "queued"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 lg:pt-1">
          <div className="match-controls">
            <div className="match-mode-switcher">
              {MATCH_MODES.map((m) => {
                const active = mode === m.key;
                return (
                  <button
                    key={m.key}
                    type="button"
                    className={`match-mode${active ? " is-active" : ""}`}
                    aria-pressed={active}
                    onClick={() => selectMode(m.key)}
                  >
                    {active ? (
                      <motion.span
                        layoutId="match-mode-pill"
                        className="match-mode-pill"
                        initial={false}
                        transition={{ type: "spring", stiffness: 500, damping: 35 }}
                        aria-hidden="true"
                      />
                    ) : null}
                    <span style={{ position: "relative" }}>{m.label}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              title="Re-run matching query"
              aria-label="Re-run matching query"
              className="match-run press"
              onClick={runQuery}
            >
              <svg
                className="w-4 h-4 text-ink"
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
            </button>
          </div>

          <div className="relative mt-10 min-h-[88px]">
            <div key={mode} className="match-copy">
              <h3 className="text-lg font-semibold tracking-[-0.01em] text-ink">
                {MATCH_COPY[mode].title}
              </h3>
              <p className="text-[15px] leading-relaxed text-body mt-2">
                {MATCH_COPY[mode].desc}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const FAQS = [
  {
    q: "How is Tammy fundamentally different from LinkedIn or standard job boards?",
    a: "Traditional boards incentivize candidates to spam 200 keyword-stuffed resumes into black-box ATS filters. On Tammy, you build a single, comprehensive engineering record backed by concrete artifacts (PRs, benchmarks, architecture decisions). Employers search semantically for what you built, and reach out directly with verified context.",
  },
  {
    q: "Can my current employer see that I have an active profile on Tammy?",
    a: "No. You can block specific domain names, corporate entities, or current employers with a single toggle. Additionally, there is no public candidate listing; only accredited, vetted hiring teams running calibrated searches can query indexed candidate signals.",
  },
  {
    q: 'What is the "Deep Read Judge" and how are scores formed?',
    a: "The Deep Read Judge is a structured reasoning model that inspects technical contributions across 5 distinct axes: system scale, architectural depth, operational evidence, verified metrics, and verified seniority. It does not output a mysterious vanity score-it gives the hiring manager written exhibits and specific suggested questions.",
  },
  {
    q: "Is Tammy completely free for engineers and builders?",
    a: "Yes, 100% free forever for candidates. Tammy monetizes strictly on the employer side through search subscriptions and successful placement guarantees. We never charge candidates for visibility, priority indexing, or unlocking offers.",
  },
];

export function FaqList() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="faq-list max-w-2xl mx-auto w-full">
      {FAQS.map((f, i) => {
        const isOpen = open === i;
        return (
          <div className="faq-item" key={f.q}>
            <button
              type="button"
              id={`faq-q-${i}`}
              className="faq-trigger"
              aria-expanded={isOpen}
              aria-controls={`faq-panel-${i}`}
              onClick={() => setOpen(isOpen ? null : i)}
            >
              <span>{f.q}</span>
              <span className="faq-trigger-ico">
                <svg
                  className="w-4 h-4 shrink-0 transition-transform duration-200"
                  style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}
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
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </span>
            </button>
            <div
              className={`faq-body${isOpen ? " open" : ""}`}
              id={`faq-panel-${i}`}
              role="region"
              aria-labelledby={`faq-q-${i}`}
              aria-hidden={isOpen ? undefined : true}
            >
              <div>
                <p>{f.a}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
