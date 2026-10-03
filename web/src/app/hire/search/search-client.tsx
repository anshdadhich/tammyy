"use client";

import Link from "next/link";
import { useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { DOMAINS, EMPLOYMENT_TYPES } from "@/lib/skills";
import { jobSchema } from "@/lib/validators";
import ResultsView from "./results-view";
import SearchingPanel from "./searching-panel";
import SkillPicker from "./skill-picker";
import {
  apiError,
  deriveTitle,
  postJson,
  type SearchRow,
  type SearchRun,
  type SessionInfo,
  type View,
} from "./common";

const DEMO_QUERY =
  "Backend engineer on Node/Postgres - designs the service boundaries, owns the schema, and keeps p95 honest under load. Payments experience is a plus; rigor is the requirement.";

const TRY_CHIPS = [
  "Designer · fintech · remote",
  "Backend · Node/Postgres",
  "Design systems lead",
];

const SENIORITIES = ["Intern", "Junior", "Mid", "Senior", "Lead", "Staff"];
const WORK_MODES = ["Remote", "Hybrid", "On-site"];
const EXPERIENCE = ["Any", "1–3 years", "3–5 years", "5–8 years", "8+ years"];
const CURRENCIES = ["INR", "USD", "EUR", "GBP", "SGD", "AED", "AUD", "CAD"];

function expRange(label: string): { min: number; max: number } {
  if (label === "1–3 years") return { min: 1, max: 3 };
  if (label === "3–5 years") return { min: 3, max: 5 };
  if (label === "5–8 years") return { min: 5, max: 8 };
  if (label === "8+ years") return { min: 8, max: 50 };
  return { min: 0, max: 50 };
}

function Ico({
  size = 14,
  className,
  children,
}: {
  size?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

type Props = {
  session: SessionInfo;
};

export default function SearchClient({ session }: Props) {
  const [view, setView] = useState<View>("compose");
  const [runs, setRuns] = useState<SearchRun[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const [query, setQuery] = useState(DEMO_QUERY);
  const [deep, setDeep] = useState(true);
  const [refineOpen, setRefineOpen] = useState(true);
  const [seniority, setSeniority] = useState("Mid");
  const [workMode, setWorkMode] = useState("Remote");
  const [exp, setExp] = useState("Any");
  const [skills, setSkills] = useState<string[]>(["Node.js", "PostgreSQL"]);
  const [currency, setCurrency] = useState("INR");
  const [amount, setAmount] = useState("");
  const [domain, setDomain] = useState("Software Development");
  const [employment, setEmployment] = useState("full-time");
  const [relocation, setRelocation] = useState(false);

  const searching = view === "searching";
  const lastRun = runs[0];
  const expSummary = exp === "Any" ? "any experience" : exp.toLowerCase();
  const summary = `${seniority} · ${workMode} · ${expSummary} · ${skills.length} must-have${
    skills.length === 1 ? "" : "s"
  }`;

  async function runSearch(): Promise<void> {
    if (searching) return;
    const range = expRange(exp);
    const amountDigits = amount.replace(/\D/g, "");
    const job: Record<string, unknown> = {
      title: deriveTitle(query),
      domain,
      seniority: seniority.toLowerCase(),
      must_have: skills,
      nice_to_have: [],
      min_exp: range.min,
      max_exp: range.max,
      currency,
      remote_policy:
        workMode === "Remote" ? "remote" : workMode === "Hybrid" ? "hybrid" : "onsite",
      relocation_allowed: relocation,
      employment_type: employment,
      description: query.trim(),
    };
    if (amountDigits) job.salary_max = Number(amountDigits);
    const parsed = jobSchema.safeParse(job);
    if (!parsed.success) {
      setError(apiError({ errors: parsed.error.flatten() }));
      return;
    }
    setError("");
    setView("searching");
    setStatus(`Searching for ${parsed.data.title}…`);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 90_000);
    try {
      const json = (await postJson("/api/search", { job: parsed.data, deep }, { signal: controller.signal })) as {
        results?: SearchRow[];
        searchId?: string | null;
        deepError?: string;
        degraded?: boolean;
      };
      const results = Array.isArray(json.results) ? json.results : [];
      const run: SearchRun = {
        id: json.searchId ?? `run-${Date.now()}`,
        title: parsed.data.title,
        time: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
        deep,
        results,
      };
      if (json.deepError) run.note = json.deepError;
      if (json.degraded) {
        run.degraded = true;
        run.note = run.note
          ? `${run.note} · semantic matching degraded, showing fallback results`
          : "Semantic matching degraded — showing fallback results, not ranked matches.";
      }
      setRuns((prev) => [run, ...prev]);
      setActiveId(run.id);
      setSelectedId(results[0]?.id ?? null);
      setView(results.length ? "detail" : "results");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setView("compose");
    } finally {
      window.clearTimeout(timer);
      setStatus("");
    }
  }

  function onComposerKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    void runSearch();
  }

  function selectRun(id: string): void {
    const run = runs.find((candidate) => candidate.id === id);
    if (!run) return;
    setActiveId(run.id);
    setSelectedId(run.results[0]?.id ?? null);
    setView(run.results.length ? "detail" : "results");
  }

  function selectCandidate(id: string): void {
    setSelectedId(id);
    setView("detail");
  }

  function showLastResults(): void {
    if (!lastRun) return;
    setActiveId(lastRun.id);
    setSelectedId(lastRun.results[0]?.id ?? null);
    setView(lastRun.results.length ? "detail" : "results");
  }

  function newSearch(): void {
    setView("compose");
    setStatus("");
    setError("");
  }

  function backToResults(): void {
    setSelectedId(null);
    setView("results");
  }

  if (view === "searching") {
    return <SearchingPanel title={status.replace(/^Searching for /, "").replace(/…$/, "") || "your role"} />;
  }

  if (view === "results" || view === "detail") {
    return (
      <ResultsView
        runs={runs}
        activeId={activeId}
        selectedId={selectedId}
        showDetail={view === "detail"}
        onSelectRun={selectRun}
        onSelectCandidate={selectCandidate}
        onNewSearch={newSearch}
        onBack={backToResults}
      />
    );
  }

  return (
    <div className="max-w-[860px] mx-auto px-6 pb-24">
      <section className="pt-16 lg:pt-24 pb-8">
        <div className="text-center">
          <h1
            className="rise text-[clamp(2rem,4.6vw,3.25rem)] font-semibold tracking-[-0.03em] leading-[1.06] text-ink"
            style={{ "--d": "60ms" } as CSSProperties}
          >
            Who do you need?
          </h1>
          <p
            className="rise mt-4 text-[17px] leading-[1.6] text-muted max-w-[560px] mx-auto"
            style={{ "--d": "160ms" } as CSSProperties}
          >
            Describe your target role in plain English. Requirements get parsed automatically and
            matched against verified candidates.
          </p>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-center gap-2.5 mb-5 text-[13px] text-muted">
        <span
          className="pulse-dot inline-block w-2 h-2 rounded-full"
          style={{
            background: session.employerStatus === "verified" ? "var(--success)" : "var(--warn)",
          }}
          aria-hidden="true"
        />
        <span className="font-mono text-[11.5px] uppercase tracking-[0.14em]">
          {session.name ? `${session.name} · ${session.email}` : session.email}
        </span>
        <span aria-hidden="true">·</span>
        <Link
          href="/hire/login"
          className="text-muted underline hover:text-brand-text transition-colors"
        >
          Switch session
        </Link>
      </div>

      <div className="sq-try">
        <span className="sq-try-label">Try</span>
        {TRY_CHIPS.map((chip) => (
          <button key={chip} type="button" className="chip-toggle" onClick={() => setQuery(chip)}>
            {chip}
          </button>
        ))}
      </div>

      <div className="composer">
        <textarea
          className="composer-input"
          maxLength={10000}
          placeholder="Describe the role you're hiring for…"
          aria-label="Describe the role you're hiring for"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onComposerKeyDown}
        />
        <div className="composer-bar">
          <div className="flex flex-wrap items-center gap-2.5 min-w-0">
            <button
              type="button"
              className={`chip-toggle${deep ? " is-on" : ""}`}
              aria-pressed={deep}
              onClick={() => setDeep((on) => !on)}
            >
              <Ico>
                <path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" />
                <path d="M20 2v4" />
                <path d="M22 4h-4" />
                <circle cx="4" cy="20" r="2" />
              </Ico>
              Deep read
            </button>
            <span className="sq-hint">
              <span className="sq-kbd">⏎</span> search
              <span aria-hidden="true"> · </span>
              <span className="sq-kbd">⇧⏎</span> newline
            </span>
          </div>
          <button
            type="button"
            className="send-btn"
            aria-label="Run search"
            disabled={searching}
            onClick={() => void runSearch()}
          >
            {searching ? (
              <span className="spin" aria-hidden="true" />
            ) : (
              <Ico size={18}>
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </Ico>
            )}
          </button>
        </div>
      </div>

      <p
        className={status ? "field-hint mt-3" : "field-hint"}
        aria-live="polite"
      >
        {searching ? (
          <span key={status} className="stage-row inline-flex items-center gap-2">
            <span className="pulse-dot inline-block w-1.5 h-1.5 rounded-full bg-brand" aria-hidden="true" />
            {status}
          </span>
        ) : (
          status
        )}
      </p>
      <p className={error ? "field-error mt-2" : "field-error"} role="alert">
        {error}
      </p>

      <div className="rounded-2xl bg-surface shadow-soft-md mt-5 overflow-hidden">
        <button
          type="button"
          className="btn-plain flex w-full items-center justify-between gap-3 sq-refine-head"
          aria-expanded={refineOpen}
          onClick={() => setRefineOpen((open) => !open)}
        >
          <span className="flex items-center gap-3 min-w-0">
            <span className="sq-refine-ic" aria-hidden="true">
              <Ico size={16}>
                <path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                <rect width="20" height="14" x="2" y="6" rx="2" />
              </Ico>
            </span>
            <span className="min-w-0 text-left">
              <span className="block text-[15px] font-semibold text-ink tracking-[-0.01em]">
                Refine constraints
              </span>
              <span className="sq-refine-sum">{summary}</span>
            </span>
          </span>
          <span className="flex items-center gap-1.5 text-[13px] text-muted flex-none">
            {refineOpen ? "Collapse" : "Expand"}
            <Ico
              size={15}
              className={`transition-transform${refineOpen ? " rotate-90" : ""}`}
            >
              <path d="m9 18 6-6-6-6" />
            </Ico>
          </span>
        </button>

        {refineOpen ? (
          <div className="px-5 pb-6 pt-5 border-t border-line grid gap-6 sq-refine-body">
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="field">
                <span className="field-label">Seniority</span>
                <div className="seg" role="group" aria-label="Seniority">
                  {SENIORITIES.map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={`seg-btn${seniority === option ? " is-on" : ""}`}
                      aria-pressed={seniority === option}
                      onClick={() => setSeniority(option)}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span className="field-label">Work mode</span>
                <div className="seg" role="group" aria-label="Work mode">
                  {WORK_MODES.map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={`seg-btn${workMode === option ? " is-on" : ""}`}
                      aria-pressed={workMode === option}
                      onClick={() => setWorkMode(option)}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="field">
              <span className="field-label">Experience range</span>
              <div className="flex flex-wrap gap-2 mt-1">
                {EXPERIENCE.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`chip-toggle${exp === option ? " is-on" : ""}`}
                    aria-pressed={exp === option}
                    onClick={() => setExp(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <SkillPicker skills={skills} onChange={setSkills} />

            <div className="field">
              <span className="field-label">Target compensation (annual)</span>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="field mb-0">
                  <label className="field-label" htmlFor="refine-currency">
                    Currency
                  </label>
                  <select
                    id="refine-currency"
                    className="select"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                  >
                    {CURRENCIES.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field mb-0">
                  <label className="field-label" htmlFor="refine-amount">
                    Amount
                  </label>
                  <input
                    id="refine-amount"
                    className="input"
                    inputMode="numeric"
                    placeholder="e.g. 50000"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="field mb-0">
                <label className="field-label" htmlFor="refine-domain">
                  Domain
                </label>
                <select
                  id="refine-domain"
                  className="select"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                >
                  {DOMAINS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field mb-0">
                <label className="field-label" htmlFor="refine-employment">
                  Employment
                </label>
                <select
                  id="refine-employment"
                  className="select"
                  value={employment}
                  onChange={(e) => setEmployment(e.target.value)}
                >
                  {EMPLOYMENT_TYPES.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label className="check">
              <input
                type="checkbox"
                checked={relocation}
                onChange={(e) => setRelocation(e.target.checked)}
              />
              <span>Must be open to relocation</span>
            </label>
          </div>
        ) : null}
      </div>

      {lastRun ? (
        <div className="mt-6">
          <button type="button" className="btn-link" onClick={showLastResults}>
            View last results ({lastRun.results.length}){" "}
            <Ico>
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </Ico>
          </button>
        </div>
      ) : null}
    </div>
  );
}
