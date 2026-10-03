"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import TraceFill from "@/components/TraceFill";
import {
  fmtMoney,
  initials,
  levelLabel,
  levelOf,
  postJson,
  scoreOf,
  stackOf,
  subScores,
  type SearchRow,
} from "./common";

type Props = {
  row: SearchRow;
  onBack: () => void;
};

type SubKey = "semantic" | "skill" | "depth" | "constraints" | "seniority";

const SUB_ORDER: SubKey[] = ["semantic", "skill", "depth", "constraints", "seniority"];

const SUB_LABELS: Record<SubKey, string> = {
  semantic: "semantic match",
  skill: "skills overlap",
  depth: "depth of work",
  constraints: "constraint fit",
  seniority: "seniority fit",
};

const Q1 = "Which parts of their experience match our requirement?";
const Q2 = "What have they built that maps to this role?";
const Q3 = "Where do they fall short of our requirement?";
const Q4 = "Should we move them forward?";

const LINK_CLASS =
  "underline decoration-muted underline-offset-2 transition-colors hover:text-brand-text break-all";

function Ico({ size = 14, children }: { size?: number; children: ReactNode }) {
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
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function pct(value: number): string {
  const normalized = value <= 1 ? value * 100 : value;
  return `${Math.round(normalized)}%`;
}

function listSentence(items: string[]): string {
  const cleaned = items.map((s) => s.trim().replace(/[.\s]+$/, "")).filter(Boolean);
  return `${cleaned.join(", ")}.`;
}

function dateRange(start?: string, end?: string, current?: boolean): string {
  const from = (start ?? "").trim();
  const to = current ? "Present" : (end ?? "").trim();
  if (from && to) return `${from} – ${to}`;
  return from || to;
}

function uniqueLinks(urls: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const url = (raw ?? "").trim();
    if (url && !seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="mt-2 text-[13.5px] leading-[1.65] text-body whitespace-pre-line">
      <span className="font-semibold text-ink">{label} </span>
      {children}
    </p>
  );
}

function TechTags({ items }: { items?: string[] | null }) {
  const list = (items ?? []).filter((t) => typeof t === "string" && t.trim());
  if (!list.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {list.map((tag, i) => (
        <span className="tag" key={`${tag}-${i}`}>
          {tag}
        </span>
      ))}
    </div>
  );
}

function LinkRow({ urls }: { urls: Array<string | null | undefined> }) {
  const list = uniqueLinks(urls);
  if (!list.length) return null;
  return (
    <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px]">
      {list.map((url) => (
        <a
          key={url}
          href={url}
          className={LINK_CLASS}
          target="_blank"
          rel="noopener noreferrer"
        >
          {url}
        </a>
      ))}
    </div>
  );
}

export default function CandidateDetail({ row, onBack }: Props) {
  const [shortlistState, setShortlistState] = useState<"idle" | "busy" | "done">("idle");
  const [contactState, setContactState] = useState<"idle" | "busy" | "done">("idle");
  const [actionError, setActionError] = useState("");

  const score = scoreOf(row);
  const level = levelOf(row);
  const judge = row.judge ?? null;
  const stack = stackOf(row);
  const subs = subScores(row);
  const subEntries = SUB_ORDER.filter(
    (k) => typeof subs[k] === "number",
  ).map((k) => [k, subs[k] as number] as [SubKey, number]);
  const experiences = row.work_experiences ?? [];
  const projects = row.projects ?? [];
  const education = row.education ?? [];
  const openSource = row.open_source_contributions ?? [];

  const shortlistLabel =
    shortlistState === "busy" ? "Shortlisting…" : shortlistState === "done" ? "Shortlisted" : "Shortlist";
  const contactLabel =
    contactState === "busy" ? "Contacting…" : contactState === "done" ? "Contacted" : "Contact";

  const runAction = async (
    kind: "shortlist" | "contact",
    setState: (next: "idle" | "busy" | "done") => void,
    currentState: "idle" | "busy" | "done",
  ): Promise<void> => {
    if (currentState !== "idle") return;
    setActionError("");
    setState("busy");
    try {
      if (kind === "shortlist") {
        await postJson("/api/shortlists", { candidate_id: row.id });
      } else {
        await postJson("/api/contacts", { candidate_id: row.id });
      }
      setState("done");
    } catch (e) {
      setState("idle");
      setActionError(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  type EvidencePointLike = { claim?: string; evidence?: string } | string;
  const pointText = (p: EvidencePointLike): string => {
    if (typeof p === "string") return p;
    const claim = (p.claim ?? "").trim();
    const evidence = (p.evidence ?? "").trim();
    return evidence ? `${claim} — ${evidence}` : claim;
  };

  const q1: string[] = [];
  if (subEntries.length) {
    q1.push(
      `${subEntries.map(([k, v]) => `${SUB_LABELS[k]} ${pct(v)}`).join(" · ")} lead the sub-scores.`,
    );
  }
  if (judge?.matched_requirements?.length) {
    q1.push(`Matched requirements: ${listSentence(judge.matched_requirements)}`);
  }
  if (stack.length) q1.push(`Core stack covers ${stack.join(", ")}.`);
  if (!q1.length && score != null) q1.push(`Overall match scores ${score}/100.`);

  const q2: string[] = [];
  if (judge?.strengths?.length) {
    q2.push(`Deep read strengths: ${listSentence(judge.strengths.map(pointText))}`);
  }
  if (judge?.project_evidence?.length) {
    q2.push(`Closest project evidence: ${listSentence(judge.project_evidence)}`);
  }
  if (typeof subs.depth === "number") q2.push(`Depth of work scores ${pct(subs.depth)} on this profile.`);
  if (stack.length) q2.push(`Ships with ${stack.join(", ")}.`);
  if (!q2.length && projects.length) {
    q2.push(`Profile lists ${projects.length} project${projects.length === 1 ? "" : "s"}.`);
  }

  const q3: string[] = [];
  if (judge?.missing_requirements?.length) {
    q3.push(`Missing requirements: ${listSentence(judge.missing_requirements)}`);
  }
  if (judge?.gaps?.length) q3.push(`Deep read gaps: ${listSentence(judge.gaps.map(pointText))}`);
  if (judge?.risk_factors?.length) q3.push(`Risk factors: ${listSentence(judge.risk_factors.map(pointText))}`);
  if (!q3.length && subEntries.length) {
    const weakest = [...subEntries].sort((a, b) => a[1] - b[1])[0];
    q3.push(`Weakest sub-score: ${SUB_LABELS[weakest[0]]} ${pct(weakest[1])}.`);
  }

  const q4: string[] = [];
  const effective =
    score ?? (typeof judge?.overall_score === "number" ? Math.round(judge.overall_score) : null);
  if (effective != null) {
    const verdict =
      level === "strong"
        ? "a strong match"
        : level === "partial"
          ? "a partial match"
          : level === "weak"
            ? "a weak match"
            : "unrated";
    const top = [...subEntries]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([k, v]) => `${SUB_LABELS[k]} ${pct(v)}`);
    let line = `Move them forward - ${effective}/100, ${verdict}`;
    if (top.length) line += `, led by ${top.join(" · ")}`;
    q4.push(`${line}.`);
  }
  const verdictText = (judge?.verdict ?? "").trim();
  if (verdictText) q4.push(/[.!?]$/.test(verdictText) ? verdictText : `${verdictText}.`);
  const recommendation = (judge?.recommendation ?? "").trim();
  if (recommendation && recommendation !== verdictText) {
    q4.push(/[.!?]$/.test(recommendation) ? recommendation : `${recommendation}.`);
  }

  const qa = [
    { num: "01", q: Q1, a: q1.join(" ") },
    { num: "02", q: Q2, a: q2.join(" ") },
    { num: "03", q: Q3, a: q3.join(" ") },
    { num: "04", q: Q4, a: q4.join(" ") },
  ].filter((item) => item.a.trim());

  const questions =
    judge?.interview_questions?.map((qq) =>
      typeof qq === "string"
        ? { question: qq, why_ask: "", follow_ups: [] as string[] }
        : { question: qq.question ?? "", why_ask: qq.why_ask ?? "", follow_ups: qq.follow_ups ?? [] },
    ).filter((qq) => qq.question.trim()) ?? [];

  const facts: Array<{ label: string; node: ReactNode }> = [];
  if (row.full_name) facts.push({ label: "Name", node: row.full_name });
  if (row.headline) facts.push({ label: "Headline", node: row.headline });
  if (row.domain) facts.push({ label: "Domain", node: row.domain });
  if (typeof row.total_experience_years === "number") {
    facts.push({ label: "Experience (years)", node: String(row.total_experience_years) });
  }
  if (row.location_city) facts.push({ label: "Location", node: row.location_city });
  if (row.remote_preference) facts.push({ label: "Work mode", node: row.remote_preference });
  if (row.availability_status) facts.push({ label: "Availability", node: row.availability_status });
  if (typeof row.min_salary === "number" && row.min_salary > 0) {
    facts.push({ label: "Minimum salary", node: fmtMoney(row.min_salary) });
  }
  if (row.salary_frequency) facts.push({ label: "Salary frequency", node: row.salary_frequency });
  if (row.contact_email) {
    facts.push({
      label: "Email",
      node: (
        <a className={LINK_CLASS} href={`mailto:${row.contact_email}`}>
          {row.contact_email}
        </a>
      ),
    });
  }
  if (row.contact_phone) {
    facts.push({
      label: "Phone",
      node: (
        <a className={LINK_CLASS} href={`tel:${row.contact_phone}`}>
          {row.contact_phone}
        </a>
      ),
    });
  }
  if (row.linkedin_url) {
    facts.push({
      label: "LinkedIn",
      node: (
        <a className={LINK_CLASS} href={row.linkedin_url} target="_blank" rel="noopener noreferrer">
          {row.linkedin_url}
        </a>
      ),
    });
  }
  if (row.resume_url) {
    facts.push({
      label: "Resume",
      node: (
        <a className={LINK_CLASS} href={row.resume_url} target="_blank" rel="noopener noreferrer">
          {row.resume_url}
        </a>
      ),
    });
  }
  if (row.portfolio_url) {
    facts.push({
      label: "Portfolio",
      node: (
        <a className={LINK_CLASS} href={row.portfolio_url} target="_blank" rel="noopener noreferrer">
          {row.portfolio_url}
        </a>
      ),
    });
  }
  if (row.github_url) {
    facts.push({
      label: "GitHub",
      node: (
        <a className={LINK_CLASS} href={row.github_url} target="_blank" rel="noopener noreferrer">
          {row.github_url}
        </a>
      ),
    });
  }

  const hasDetails =
    facts.length > 0 ||
    experiences.length > 0 ||
    projects.length > 0 ||
    education.length > 0 ||
    openSource.length > 0 ||
    stack.length > 0;

  const itemCard = "border-b border-line py-4 first:pt-0 last:border-b-0 last:pb-0";

  return (
    <div>
      <div className="mb-3">
        <button type="button" className="btn-link" onClick={onBack}>
          <Ico>
            <path d="M19 12H5" />
            <path d="m12 19-7-7 7-7" />
          </Ico>
          Back to results
        </button>
      </div>

      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className="grid place-items-center rounded-full bg-brand-soft text-brand-text font-semibold select-none"
          style={{ width: 56, height: 56, fontSize: 20 }}
        >
          {initials(row.full_name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h2 className="text-[21px] font-semibold text-ink tracking-[-0.015em]">
              {row.full_name ?? "Candidate"}
            </h2>
            {level ? (
              <span className={`level-pill level-${level}`}>{levelLabel(level)}</span>
            ) : null}
          </div>
          {row.headline ? <p className="text-[14.5px] text-body mt-1">{row.headline}</p> : null}
        </div>
        {score != null ? (
          <div className="flex-none text-right">
            <div className="sq-score">
              {score}
              <span>/100</span>
            </div>
            <p className="sq-score-cap">{level ? levelLabel(level) : "Matched"}</p>
          </div>
        ) : null}
      </div>

      {score != null ? (
        <div className="mt-4">
          <div className="trace-rule" aria-hidden="true">
            <TraceFill width={`${score}%`} background="#1F2DE6" />
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2.5 mt-4">
        <Link href={`/talent/${row.id}`} className="btn btn-primary btn-sm press">
          View page{" "}
          <Ico>
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </Ico>
        </Link>
        <button
          type="button"
          className="btn btn-secondary btn-sm press"
          disabled={shortlistState !== "idle"}
          onClick={() => void runAction("shortlist", setShortlistState, shortlistState)}
        >
          <Ico>
            <path d="M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z" />
          </Ico>
          {shortlistLabel}
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm press"
          disabled={contactState !== "idle"}
          onClick={() => void runAction("contact", setContactState, contactState)}
        >
          <Ico>
            <path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7" />
            <rect x="2" y="4" width="20" height="16" rx="2" />
          </Ico>
          {contactLabel}
        </button>
        {row.contact_email ? (
          <a href={`mailto:${row.contact_email}`} className="tag hover:text-brand-text transition-colors">
            <Ico size={13}>
              <path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7" />
              <rect x="2" y="4" width="20" height="16" rx="2" />
            </Ico>
            Email
          </a>
        ) : null}
        {row.contact_phone ? (
          <a href={`tel:${row.contact_phone}`} className="tag hover:text-brand-text transition-colors">
            <Ico size={13}>
              <path d="M9 17H7A5 5 0 0 1 7 7h2" />
              <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
              <line x1="8" x2="16" y1="12" y2="12" />
            </Ico>
            {row.contact_phone}
          </a>
        ) : null}
        {row.linkedin_url ? (
          <a
            href={row.linkedin_url}
            className="tag hover:text-brand-text transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Ico size={13}>
              <path d="M15 3h6v6" />
              <path d="M10 14 21 3" />
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            </Ico>
            LinkedIn
          </a>
        ) : null}
        {row.github_url ? (
          <a
            href={row.github_url}
            className="tag hover:text-brand-text transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Ico size={13}>
              <path d="M15 3h6v6" />
              <path d="M10 14 21 3" />
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            </Ico>
            GitHub
          </a>
        ) : null}
      </div>

      {actionError ? (
        <p className="field-error mt-2" role="alert">
          {actionError}
        </p>
      ) : null}
      {row.contact_locked ? (
        <p className="field-hint mt-2">
          Contact details stay hidden until you shortlist or contact this candidate — re-run the
          search to load them.
        </p>
      ) : null}

      {qa.length ? (
        <section className="mt-6 pt-5 border-t border-line">
          <p className="sq-overline">
            AI analysis - the answers{" "}
            <Ico size={12}>
              <path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" />
              <path d="M20 2v4" />
              <path d="M22 4h-4" />
              <circle cx="4" cy="20" r="2" />
            </Ico>
          </p>
          <div className="grid gap-2.5 mt-3">
            {qa.map((item) => (
              <div className="sq-qa" key={item.num}>
                <div className="sq-qa-head">
                  <span className="sq-qa-num" aria-hidden="true">
                    {item.num}
                  </span>
                  <p className="sq-qa-q">{item.q}</p>
                </div>
                <div className="sq-qa-a">{item.a}</div>
              </div>
            ))}
          </div>

          {questions.length ? (
            <div className="mt-5">
              <p className="sq-overline">Interview questions</p>
              <div className="grid gap-2.5 mt-3">
                {questions.map((qq, i) => (
                  <div className="sq-qa" key={`qq-${i}`}>
                    <div className="sq-qa-head">
                      <span className="sq-qa-num" aria-hidden="true">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <p className="sq-qa-q">{qq.question}</p>
                    </div>
                    <div className="sq-qa-a">
                      {qq.why_ask ? <p>{qq.why_ask}</p> : null}
                      {qq.follow_ups.length ? (
                        <ul className="mt-1 pl-4 list-disc text-[13px] text-muted">
                          {qq.follow_ups.map((f, j) => (
                            <li key={j}>{f}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {hasDetails ? (
        <section className="mt-6 pt-5 border-t border-line">
          <p className="sq-overline">Details</p>
          <div className="mt-3 grid gap-6">
            {facts.length ? (
              <div>
                <h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-ink tracking-[-0.01em]">
                  <Ico>
                    <circle cx="12" cy="8" r="5" />
                    <path d="M20 21a8 8 0 0 0-16 0" />
                  </Ico>
                  Profile facts
                </h3>
                <dl className="mt-2.5 grid gap-x-10 lg:grid-cols-2 sq-facts">
                  {facts.map((fact) => (
                    <div className="sq-detail-row" key={fact.label}>
                      <dt>{fact.label}</dt>
                      <dd>{fact.node}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}

            {experiences.length ? (
              <div>
                <h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-ink tracking-[-0.01em]">
                  <Ico>
                    <path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                    <rect width="20" height="14" x="2" y="6" rx="2" />
                  </Ico>
                  Work experience
                </h3>
                <div className="mt-2 grid">
                  {experiences.map((exp, i) => {
                    const range = dateRange(exp.start_date, exp.end_date, exp.is_current);
                    return (
                      <div className={itemCard} key={`exp-${i}`}>
                        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                          <p className="text-[14.5px] font-semibold text-ink tracking-[-0.01em]">
                            {exp.job_title || "Role"}
                          </p>
                          {range ? (
                            <p className="font-mono text-[12.5px] text-muted">{range}</p>
                          ) : null}
                        </div>
                        {exp.company_name ? (
                          <p className="mt-0.5 text-[13.5px] text-body">{exp.company_name}</p>
                        ) : null}
                        {exp.description ? (
                          <Labeled label="Description - ">{exp.description}</Labeled>
                        ) : null}
                        {exp.achievements ? (
                          <Labeled label="Achievements - ">{exp.achievements}</Labeled>
                        ) : null}
                        <TechTags items={exp.tech_stack} />
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {projects.length ? (
              <div>
                <h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-ink tracking-[-0.01em]">
                  <Ico>
                    <path d="M18 19a5 5 0 0 1-5-5v8" />
                    <path d="M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5" />
                    <circle cx="13" cy="12" r="2" />
                    <circle cx="20" cy="19" r="2" />
                  </Ico>
                  Projects
                </h3>
                <div className="mt-2 grid">
                  {projects.map((project, i) => (
                    <div className={itemCard} key={`project-${i}`}>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <p className="text-[14.5px] font-semibold text-ink tracking-[-0.01em]">
                          {project.title || "Project"}
                        </p>
                        {project.project_type ? (
                          <p className="font-mono text-[12.5px] text-muted">{project.project_type}</p>
                        ) : null}
                      </div>
                      {project.role_in_project ? (
                        <p className="mt-1 text-[13.5px] text-body">
                          <span className="font-semibold text-ink">Role - </span>
                          {project.role_in_project}
                        </p>
                      ) : null}
                      {project.problem_statement ? (
                        <Labeled label="Problem - ">{project.problem_statement}</Labeled>
                      ) : null}
                      {project.description ? (
                        <Labeled label="Description - ">{project.description}</Labeled>
                      ) : null}
                      {project.impact_summary ? (
                        <Labeled label="Impact - ">{project.impact_summary}</Labeled>
                      ) : null}
                      <TechTags items={project.tech_stack} />
                      <LinkRow
                        urls={[project.repo_link, project.project_link, project.deployment_link]}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {education.length ? (
              <div>
                <h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-ink tracking-[-0.01em]">
                  <Ico>
                    <path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z" />
                    <path d="M22 10v6" />
                    <path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5" />
                  </Ico>
                  Education
                </h3>
                <div className="mt-2 grid">
                  {education.map((edu, i) => {
                    const years = [edu.start_year, edu.end_year]
                      .filter((v) => v !== undefined && v !== null && `${v}` !== "")
                      .join(" – ");
                    const degree = [edu.degree, edu.field_of_study]
                      .filter((v) => typeof v === "string" && v.trim())
                      .join(", ");
                    return (
                      <div className={itemCard} key={`edu-${i}`}>
                        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                          <p className="text-[14.5px] font-semibold text-ink tracking-[-0.01em]">
                            {edu.institution || "Institution"}
                          </p>
                          {years ? (
                            <p className="font-mono text-[12.5px] text-muted">{years}</p>
                          ) : null}
                        </div>
                        {degree ? <p className="mt-0.5 text-[13.5px] text-body">{degree}</p> : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {openSource.length ? (
              <div>
                <h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-ink tracking-[-0.01em]">
                  <Ico>
                    <circle cx="18" cy="18" r="3" />
                    <circle cx="6" cy="6" r="3" />
                    <path d="M13 6h3a2 2 0 0 1 2 2v7" />
                    <line x1="6" x2="6" y1="9" y2="21" />
                  </Ico>
                  Open source
                </h3>
                <div className="mt-2 grid">
                  {openSource.map((oss, i) => (
                    <div className={itemCard} key={`oss-${i}`}>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <p className="text-[14.5px] font-semibold text-ink tracking-[-0.01em] font-mono">
                          {oss.repo_name || "Repository"}
                        </p>
                        {oss.role ? (
                          <p className="font-mono text-[12.5px] text-muted">{oss.role}</p>
                        ) : null}
                      </div>
                      {oss.description ? (
                        <Labeled label="Description - ">{oss.description}</Labeled>
                      ) : null}
                      <TechTags items={oss.tech_stack} />
                      <LinkRow urls={[oss.repo_url, ...(oss.pr_links ?? [])]} />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {stack.length ? (
              <div>
                <h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-ink tracking-[-0.01em]">
                  <Ico>
                    <path d="M13.172 2a2 2 0 0 1 1.414.586l6.71 6.71a2.4 2.4 0 0 1 0 3.408l-4.592 4.592a2.4 2.4 0 0 1-3.408 0l-6.71-6.71A2 2 0 0 1 6 9.172V3a1 1 0 0 1 1-1z" />
                    <path d="M2 7v6.172a2 2 0 0 0 .586 1.414l6.71 6.71a2.4 2.4 0 0 0 3.191.193" />
                    <circle cx="10.5" cy="6.5" r=".5" fill="currentColor" />
                  </Ico>
                  Skills
                </h3>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {stack.map((skill, i) => (
                    <span className="tag" key={`${skill}-${i}`}>
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
