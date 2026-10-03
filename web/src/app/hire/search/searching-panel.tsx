"use client";

import { useEffect, useRef, useState } from "react";

const STAGES = [
  { label: "Parse brief", sub: "Reading role, stack, and constraints" },
  { label: "Embed query", sub: "Turning the brief into a semantic vector" },
  { label: "Hybrid retrieval", sub: "Vector + keyword candidate recall" },
  { label: "Score dimensions", sub: "Skills, depth, constraints, seniority" },
  { label: "Deep Read judge", sub: "Evidence-level evaluation of the top profiles" },
  { label: "Rank shortlist", sub: "Calibrating the final order" },
];

const STAGE_TICK_MS = 1600;
const EARLY_COMPLETE_TICKS = 3;

type Props = {
  title: string;
  /** Wired by the caller so the panel can offer a way out of a hung request. */
  onCancel?: () => void;
  /** Ticks before the panel stops claiming new stages and just waits. */
  totalSeconds?: number;
};

/**
 * The searching experience: orbital indicator, a stage track where each row
 * enters with a short rise and completes in turn, an elapsed clock, and a
 * completion-aware progress bar. The clock is presentational — real progress
 * is the request — but it advances plausibly (fast early, slower at the
 * judge stage) and parks on "finalizing" instead of pretending to finish.
 */
export default function SearchingPanel({ title, onCancel }: Props) {
  const [stage, setStage] = useState(0);
  const [ticks, setTicks] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    startedAt.current = Date.now();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      const t = window.setTimeout(() => {
        setStage(STAGES.length - 1);
        setTicks(EARLY_COMPLETE_TICKS);
      }, 0);
      return () => window.clearTimeout(t);
    }
    const clock = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - (startedAt.current ?? Date.now())) / 1000));
    }, 1000);
    const ticker = window.setInterval(() => {
      setTicks((n) => n + 1);
      setStage((s) => (s >= STAGES.length - 1 ? s : s + 1));
    }, STAGE_TICK_MS);
    return () => {
      window.clearInterval(clock);
      window.clearInterval(ticker);
    };
  }, []);

  // After the stage list completes, keep the bar moving plausibly toward a
  // high-water mark rather than sitting at 100% and lying about completion.
  const progress =
    stage >= STAGES.length - 1
      ? Math.min(92, 70 + ticks * 3)
      : Math.round(((stage + 0.6) / STAGES.length) * 100);

  return (
    <section className="max-w-[600px] mx-auto pt-16 lg:pt-24 pb-10">
      <div className="text-center">
        <div className="sq-orb mx-auto" aria-hidden="true">
          <div className="sq-orb-ring" />
          <div className="sq-orb-ring sq-orb-ring-2" />
          <div className="sq-orb-dot" />
        </div>

        <h1 className="mt-7 text-[clamp(1.5rem,3.4vw,2.15rem)] font-semibold tracking-[-0.02em] leading-[1.12] text-ink">
          Searching for {title}
        </h1>
        <p className="mt-2 text-[14.5px] text-muted">
          Evidence is being read, not just keywords matched — this takes a few seconds.
        </p>
      </div>

      <div className="search-progress mt-8" aria-hidden="true">
        <div className="search-progress-fill" style={{ width: `${progress}%` }} />
        <div className="sq-bar-sweep">
          <i />
        </div>
      </div>
      <div className="flex items-baseline justify-between mt-2 text-[12px] text-muted font-mono">
        <span>
          {elapsed < 60 ? `${elapsed}s elapsed` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s elapsed`}
        </span>
        <span>Deep read can take up to a minute</span>
      </div>

      <ul className="sq-stage-list">
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

      {onCancel ? (
        <div className="mt-8 text-center">
          <button type="button" className="btn-link press" onClick={onCancel}>
            Cancel and go back
          </button>
        </div>
      ) : null}
    </section>
  );
}
