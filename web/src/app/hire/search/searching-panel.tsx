"use client";

import { useEffect, useState } from "react";

const STAGES = [
  { label: "Parse brief", sub: "Reading role, stack, constraints" },
  { label: "Embed query", sub: "384-dim semantic vector" },
  { label: "Hybrid retrieval", sub: "Vector + keyword candidates" },
  { label: "Score dimensions", sub: "Skills, depth, constraints" },
  { label: "Deep Read judge", sub: "Evidence-level evaluation" },
  { label: "Rank shortlist", sub: "Calibrating final order" },
];

const STAGE_TICK_MS = 450;

/**
 * The searching panel: orb, staged pipeline rows (each entering with a
 * short rise), and a sweep bar that keeps moving while the request runs.
 * The stage clock is purely presentational — it advances every 450ms while
 * mounted and parks on the last stage if the request outlives the list.
 */
export default function SearchingPanel({ title }: { title: string }) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const t = window.setTimeout(() => setStage(STAGES.length - 1), 0);
      return () => window.clearTimeout(t);
    }
    const t = window.setInterval(() => {
      setStage((s) => (s >= STAGES.length - 1 ? s : s + 1));
    }, STAGE_TICK_MS);
    return () => window.clearInterval(t);
  }, []);

  return (
    <section className="max-w-[560px] mx-auto pt-16 lg:pt-24 pb-10 text-center">
      <div className="sq-orb mx-auto" aria-hidden="true">
        <div className="sq-orb-ring" />
        <div className="sq-orb-ring sq-orb-ring-2" />
        <div className="sq-orb-dot" />
      </div>

      <h1 className="mt-7 text-[clamp(1.5rem,3.4vw,2.15rem)] font-semibold tracking-[-0.02em] leading-[1.12] text-ink">
        Searching for {title}
      </h1>
      <p className="mt-2 text-[14.5px] text-muted">
        This takes a few seconds — evidence is being read, not just keywords matched.
      </p>

      <ul className="sq-stage-list text-left">
        {STAGES.map((s, i) => (
          <li
            key={s.label}
            className={`sq-stage stage-row${i < stage ? " is-done" : i === stage ? " is-active" : ""}`}
            style={{ "--i": i } as React.CSSProperties}
          >
            <span className="sq-stage-ic" aria-hidden="true">
              {i < stage ? "✓" : i + 1}
            </span>
            <span className="sq-stage-body">
              <span className="sq-stage-label">{s.label}</span>
              <span className="sq-stage-sub">{s.sub}</span>
            </span>
            <span className={`sq-stage-state${i === stage ? " is-running" : ""}`}>
              {i < stage ? "done" : i === stage ? "running" : "queued"}
            </span>
          </li>
        ))}
      </ul>

      <p className="sr-only" role="status">
        Step {Math.min(stage + 1, STAGES.length)} of {STAGES.length}
      </p>
      <div className="sq-bar" aria-hidden="true">
        <div
          className="sq-bar-fill"
          style={{ width: `${((stage + 1) / STAGES.length) * 100}%` }}
        />
        <div className="sq-bar-sweep">
          <i />
        </div>
      </div>
    </section>
  );
}
