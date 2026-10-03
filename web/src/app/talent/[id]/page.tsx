import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import PageShell from "@/components/PageShell";
import { readNavViewer } from "@/lib/hr-session";

type Cand = {
  id: string;
  full_name?: string | null;
  headline?: string | null;
  domain?: string | null;
  current_position?: string | null;
  total_experience_years?: number | null;
  location_city?: string | null;
  location_country?: string | null;
  remote_preference?: string | null;
  availability_status?: string | null;
  open_to_relocation?: boolean | null;
  min_salary?: number | null;
  salary_currency?: string | null;
  salary_frequency?: string | null;
  salary_negotiable?: boolean | null;
  visibility_status?: string | null;
  profile_strength?: string | number | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  linkedin_url?: string | null;
  github_url?: string | null;
  resume_url?: string | null;
  portfolio_url?: string | null;
  freshness_updated_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type Prof = { summary_markdown?: string | null; updated_at?: string | null } | null;

type Proj = {
  id?: string;
  title?: string | null;
  description?: string | null;
  problem_statement?: string | null;
  tech_stack?: string[] | null;
  role_in_project?: string | null;
  project_link?: string | null;
  repo_link?: string | null;
  deployment_link?: string | null;
  impact_summary?: string | null;
  project_type?: string | null;
};

type Exp = {
  company_name?: string | null;
  job_title?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  is_current?: boolean | null;
  description?: string | null;
  achievements?: string | null;
  tech_stack?: string[] | null;
};

type Edu = {
  institution?: string | null;
  degree?: string | null;
  field_of_study?: string | null;
  start_year?: number | null;
  end_year?: number | null;
  achievements?: string | null;
};

type SkillLink = {
  experience_years?: number | null;
  proficiency_level?: string | null;
  skills?: { name?: string | null } | null;
};

type Bundle = {
  candidate: Cand;
  profile: Prof;
  projects: Proj[];
  experiences: Exp[];
  education: Edu[];
  skills: SkillLink[];
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const load = cache(async (id: string): Promise<Bundle | null> => {
  const h = await headers();
  const fwd: Record<string, string> = { cookie: h.get("cookie") ?? "" };
  const xff = h.get("x-forwarded-for");
  const xri = h.get("x-real-ip");
  if (xff) fwd["x-forwarded-for"] = xff;
  if (xri) fwd["x-real-ip"] = xri;
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/api/candidates?id=${encodeURIComponent(id)}`, {
      headers: fwd,
      cache: "no-store",
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`candidates fetch failed: ${res.status}`);
    return (await res.json()) as Bundle;
  } catch (e) {
    console.error("[talent] profile load failed", e instanceof Error ? e.message : e);
    throw e;
  }
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return { title: "Profile not found", robots: { index: false, follow: false } };
  const bundle = await load(id);
  if (!bundle) return { title: "Profile not found", robots: { index: false, follow: false } };
  const description = (bundle.candidate.headline ?? "").trim() || undefined;
  return {
    title: bundle.candidate.full_name ? String(bundle.candidate.full_name) : "Talent profile",
    ...(description ? { description } : {}),
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDate(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const m = s.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!m) return s.length > 10 ? s.slice(0, 10) : s;
  if (m[2]) {
    const idx = Number(m[2]) - 1;
    return `${MONTHS[idx] ?? m[2]} ${m[1]}`;
  }
  return m[1];
}

const AVAIL: Record<string, string> = {
  immediate: "Available immediately",
  notice: "Serving notice",
  inactive: "Not looking right now",
};

const MODE: Record<string, string> = {
  remote_only: "Remote only",
  hybrid: "Hybrid",
  onsite: "On-site",
  flexible: "Flexible",
  remote: "Remote",
};

function safeHttpUrl(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol === "https:" || u.protocol === "http:") return u.toString();
    return null;
  } catch {
    return null;
  }
}

function safeMailto(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || /[\r\n<>]/.test(s)) return null;
  if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(s)) return null;
  return `mailto:${s}`;
}

function safeTel(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || /[\r\n<>]/.test(s)) return null;
  if (!/^[+\d][\d\s\-().]{6,19}$/.test(s)) return null;
  return `tel:${s.replace(/\s+/g, "")}`;
}

function salaryLine(c: Cand): string | null {
  if (typeof c.min_salary !== "number" || c.min_salary <= 0) return null;
  const cur = (c.salary_currency ?? "INR").toUpperCase();
  const freq =
    c.salary_frequency === "yearly" ? "year" : c.salary_frequency === "hourly" ? "hour" : "month";
  return `${cur} ${c.min_salary.toLocaleString()} / ${freq}${c.salary_negotiable === false ? "" : " (negotiable)"}`;
}

type Fact = { k: string; v: string; href?: string };

function buildFacts(c: Cand, profile: Prof): Fact[] {
  const out: Fact[] = [];
  const add = (k: string, v: unknown, href?: (s: string) => string | null) => {
    if (v === null || v === undefined) return;
    const s = typeof v === "string" ? v.trim() : String(v);
    if (!s) return;
    const link = href ? href(s) : null;
    out.push(link ? { k, v: s, href: link } : { k, v: s });
  };
  add("Full name", c.full_name);
  add("Headline", c.headline);
  add("Domain", c.domain);
  add("Current position", c.current_position);
  add("Experience (years)", c.total_experience_years);
  add("City", c.location_city);
  add("Country", c.location_country);
  add("Remote preference", c.remote_preference);
  add("Availability", c.availability_status);
  add("Open to relocation", c.open_to_relocation);
  add("Minimum salary", c.min_salary);
  add("Salary currency", c.salary_currency);
  add("Salary frequency", c.salary_frequency);
  add("Salary negotiable", c.salary_negotiable);
  add("Email", c.contact_email);
  add("Phone", c.contact_phone);
  add("LinkedIn", c.linkedin_url, safeHttpUrl);
  add("GitHub", c.github_url, safeHttpUrl);
  add("Portfolio", c.portfolio_url, safeHttpUrl);
  add("Resume", c.resume_url, safeHttpUrl);
  add("Visibility", c.visibility_status);
  add("Profile strength", c.profile_strength);
  add("Summary updated", profile?.updated_at);
  add("Profile refreshed", c.freshness_updated_at);
  add("Record created", c.created_at);
  add("Record updated", c.updated_at);
  add("Candidate id", c.id);
  return out;
}

type MdBlock =
  | { type: "h"; level: number; text: string }
  | { type: "p"; text: string }
  | { type: "ul" | "ol"; items: string[] };

function parseMd(text: string): MdBlock[] {
  const out: MdBlock[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;
  const flush = () => {
    if (list) {
      out.push(list);
      list = null;
    }
  };
  for (const raw of text.split(/\r?\n/)) {
    const h = raw.match(/^\s*(#{1,4})\s+(.*)$/);
    const ol = raw.match(/^\s*\d+[.)]\s+(.*)$/);
    const ul = raw.match(/^\s*[-*•]\s+(.*)$/);
    if (h) {
      flush();
      out.push({ type: "h", level: h[1].length, text: h[2] });
      continue;
    }
    if (ol) {
      if (!list || list.type !== "ol") {
        flush();
        list = { type: "ol", items: [] };
      }
      list.items.push(ol[1]);
      continue;
    }
    if (ul) {
      if (!list || list.type !== "ul") {
        flush();
        list = { type: "ul", items: [] };
      }
      list.items.push(ul[1]);
      continue;
    }
    flush();
    if (raw.trim()) out.push({ type: "p", text: raw.trim() });
  }
  flush();
  return out;
}

function inlineMd(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g);
  return parts.map((p, i) => {
    if (p.length > 4 && p.startsWith("**") && p.endsWith("**"))
      return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.length > 2 && p.startsWith("`") && p.endsWith("`"))
      return (
        <code key={i} className="font-mono text-[13.5px] bg-inset rounded px-1.5 py-0.5">
          {p.slice(1, -1)}
        </code>
      );
    const link = p.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (link)
      return (
        <a
          key={i}
          href={link[2]}
          className="text-brand-text underline underline-offset-2"
          target="_blank"
          rel="noopener noreferrer"
        >
          {link[1]}
        </a>
      );
    return <span key={i}>{p}</span>;
  });
}

function Markdownish({ text }: { text: string }) {
  const blocks = parseMd(text);
  return (
    <div className="grid gap-3 text-[15.5px] leading-[1.65] text-body">
      {blocks.map((b, i) => {
        if (b.type === "h")
          return (
            <p
              key={i}
              className={
                b.level <= 2
                  ? "text-[16.5px] font-semibold text-ink tracking-[-0.01em] pt-1"
                  : "text-[15.5px] font-semibold text-ink"
              }
            >
              {inlineMd(b.text)}
            </p>
          );
        if (b.type === "p") return <p key={i}>{inlineMd(b.text)}</p>;
        const items = b.items.map((it, j) => <li key={j}>{inlineMd(it)}</li>);
        return b.type === "ol" ? (
          <ol key={i} className="list-decimal pl-5 grid gap-1.5">
            {items}
          </ol>
        ) : (
          <ul key={i} className="list-disc pl-5 grid gap-1.5">
            {items}
          </ul>
        );
      })}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-9 first:mt-0 pt-8 border-t border-line first:border-0 first:pt-0">
      <div className="flex items-center gap-3">
        <h2 className="sq-overline">{title}</h2>
        <span className="h-px flex-1 bg-line" aria-hidden="true" />
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Entry({ children }: { children: ReactNode }) {
  return <div className="border-b border-line py-4 first:pt-0 last:border-b-0 last:pb-0">{children}</div>;
}

function EntryHead({
  title,
  meta,
}: {
  title: string;
  meta?: string | null;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h3 className="text-[15px] font-semibold text-ink tracking-[-0.01em]">{title}</h3>
      {meta ? <p className="font-mono text-[12.5px] text-muted">{meta}</p> : null}
    </div>
  );
}

function Body({ label, value }: { label: string; value?: string | null }) {
  const v = (value ?? "").trim();
  if (!v) return null;
  return (
    <p className="mt-2 text-[13.5px] leading-[1.65] text-body whitespace-pre-line">
      <span className="font-semibold text-ink">{label} - </span>
      {v}
    </p>
  );
}

function Lines({ label, value }: { label: string; value?: string | null }) {
  const items = (value ?? "")
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!items.length) return null;
  return (
    <div className="mt-2">
      <p className="text-[13.5px] font-semibold text-ink">{label}</p>
      <ul className="list-disc pl-5 mt-1 grid gap-1.5 text-[13.5px] leading-[1.6] text-body">
        {items.map((a, i) => (
          <li key={i}>{a}</li>
        ))}
      </ul>
    </div>
  );
}

function Chiplist({ items }: { items?: (string | null | undefined)[] | null }) {
  const clean = (items ?? []).filter((x): x is string => !!x && !!x.trim());
  if (!clean.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {clean.map((t, i) => (
        <span className="tag" key={`${t}-${i}`}>
          {t}
        </span>
      ))}
    </div>
  );
}

function LinkRow({ items }: { items: (string | null | undefined)[] }) {
  const seen = new Set<string>();
  const httpList: string[] = [];
  const textList: string[] = [];
  for (const raw of items) {
    const href = (raw ?? "").trim();
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const safe = safeHttpUrl(href);
    if (safe) httpList.push(safe);
    else textList.push(href.slice(0, 2048));
  }
  if (!httpList.length && !textList.length) return null;
  return (
    <div className="mt-2.5 flex flex-col gap-1.5 text-[12.5px]">
      {httpList.map((href) => (
        <a
          key={href}
          href={href}
          className="underline decoration-muted underline-offset-2 transition-colors hover:text-brand-text break-all"
          target="_blank"
          rel="noopener noreferrer"
        >
          {href}
        </a>
      ))}
      {textList.map((t) => (
        <span key={t} className="text-muted break-all">
          {t}
        </span>
      ))}
    </div>
  );
}

function MailIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

function MapPinIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

export default async function TalentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const bundle = await load(id);
  if (!bundle) notFound();

  const viewer = await readNavViewer();
  const c = bundle.candidate;
  const name = (c.full_name ?? "").trim() || "Candidate";
  const headline = (c.headline ?? "").trim();
  const summary = (bundle.profile?.summary_markdown ?? "").trim();
  const facts = buildFacts(c, bundle.profile);
  const salary = salaryLine(c);
  const availability = c.availability_status ? (AVAIL[c.availability_status] ?? null) : null;
  const mode = c.remote_preference ? (MODE[c.remote_preference] ?? null) : null;
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join("") || "?";

  const skillEntries = bundle.skills.flatMap((s) => {
    const embedded = s.skills ? [s.skills] : [];
    return embedded
      .map((sk) => sk?.name)
      .filter((n): n is string => !!n)
      .map((n) => ({ name: n, years: s.experience_years, level: s.proficiency_level }));
  });

  const channelBtns: ReactNode[] = [];
  const emailHref = safeMailto(c.contact_email);
  if (emailHref)
    channelBtns.push(
      <a key="email" href={emailHref} className="btn btn-primary btn-sm press">
        <MailIcon /> Email
      </a>,
    );
  const phoneHref = safeTel(c.contact_phone);
  if (phoneHref && c.contact_phone)
    channelBtns.push(
      <a key="phone" href={phoneHref} className="btn btn-secondary btn-sm press">
        {String(c.contact_phone).slice(0, 32)}
      </a>,
    );
  const liHref = safeHttpUrl(c.linkedin_url);
  if (liHref)
    channelBtns.push(
      <a
        key="li"
        href={liHref}
        className="btn btn-secondary btn-sm press"
        target="_blank"
        rel="noopener noreferrer"
      >
        LinkedIn <ExternalIcon />
      </a>,
    );
  const ghHref = safeHttpUrl(c.github_url);
  if (ghHref)
    channelBtns.push(
      <a
        key="gh"
        href={ghHref}
        className="btn btn-secondary btn-sm press"
        target="_blank"
        rel="noopener noreferrer"
      >
        GitHub <ExternalIcon />
      </a>,
    );

  return (
    <PageShell variant="landing" viewer={viewer}>
      <section className="pt-20 lg:pt-28 pb-8">
        <div className="max-w-[1160px] mx-auto px-6">
          <div
            className="rise flex flex-wrap items-center gap-3"
            style={{ "--d": "60ms" } as React.CSSProperties}
          >
            <span className="meta-chip">Talent record</span>
          </div>

          <div
            className="rise mt-5 flex flex-wrap items-start justify-between gap-6"
            style={{ "--d": "160ms" } as React.CSSProperties}
          >
            <div className="flex items-center gap-4 min-w-0">
              <span
                aria-hidden="true"
                className="grid place-items-center rounded-full bg-brand-soft text-brand-text font-semibold select-none"
                style={{ width: "64px", height: "64px", fontSize: "23px" }}
              >
                {initials}
              </span>
              <div className="min-w-0">
                <h1 className="text-[clamp(2rem,4.5vw,3.25rem)] font-semibold tracking-[-0.03em] leading-[1.06] text-ink">
                  {name}
                </h1>
                {headline ? (
                  <p className="text-[16px] text-body mt-1.5 max-w-[52ch]">{headline}</p>
                ) : null}
              </div>
            </div>
            {channelBtns.length ? (
              <div className="flex flex-wrap items-center gap-2.5">{channelBtns}</div>
            ) : null}
          </div>

          <div
            className="rise mt-5 flex flex-wrap gap-2.5"
            style={{ "--d": "280ms" } as React.CSSProperties}
          >
            {c.domain ? <span className="meta-chip">{c.domain}</span> : null}
            {typeof c.total_experience_years === "number" ? (
              <span className="meta-chip">{c.total_experience_years} yrs experience</span>
            ) : null}
            {c.location_city ? (
              <span className="meta-chip">
                <MapPinIcon /> {c.location_city}
              </span>
            ) : null}
            {mode ? <span className="meta-chip">{mode}</span> : null}
            {availability ? <span className="meta-chip">{availability}</span> : null}
            {salary ? <span className="meta-chip">{salary}</span> : null}
          </div>
        </div>
      </section>

      <section className="pb-24">
        <div className="max-w-[1160px] mx-auto px-6">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
            <div className="min-w-0">
              <Section title="Profile facts">
                <dl className="grid gap-x-10 lg:grid-cols-2 sq-facts">
                  {facts.map((f) => (
                    <div className="sq-detail-row" key={f.k}>
                      <dt>{f.k}</dt>
                      <dd>
                        {f.href ? (
                          <a
                            href={f.href}
                            className="underline decoration-muted underline-offset-2 transition-colors hover:text-brand-text"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {f.v}
                          </a>
                        ) : (
                          f.v
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </Section>

              {bundle.experiences.length ? (
                <Section title="Work experience">
                  <div>
                    {bundle.experiences.map((x, i) => {
                      const dates = [
                        fmtDate(x.start_date),
                        x.is_current ? "Present" : fmtDate(x.end_date),
                      ]
                        .filter(Boolean)
                        .join(" – ");
                      return (
                        <Entry key={`exp-${i}`}>
                          <EntryHead
                            title={x.job_title ?? x.company_name ?? "Role"}
                            meta={dates || null}
                          />
                          {x.job_title && x.company_name ? (
                            <p className="mt-0.5 text-[13.5px] text-body">{x.company_name}</p>
                          ) : null}
                          <Body label="Description" value={x.description} />
                          <Lines label="Achievements" value={x.achievements} />
                          <Chiplist items={x.tech_stack} />
                        </Entry>
                      );
                    })}
                  </div>
                </Section>
              ) : null}

              {bundle.projects.length ? (
                <Section title="Projects">
                  <div>
                    {bundle.projects.map((p, i) => (
                      <Entry key={p.id ?? `proj-${i}`}>
                        <EntryHead
                          title={p.title ?? "Project"}
                          meta={[p.role_in_project, p.project_type].filter(Boolean).join(" · ") || null}
                        />
                        <Body label="Problem" value={p.problem_statement} />
                        <Body label="Description" value={p.description} />
                        <Body label="Impact" value={p.impact_summary} />
                        <Chiplist items={p.tech_stack} />
                        <LinkRow items={[p.project_link, p.repo_link, p.deployment_link]} />
                      </Entry>
                    ))}
                  </div>
                </Section>
              ) : null}

              {bundle.education.length ? (
                <Section title="Education">
                  <div>
                    {bundle.education.map((e, i) => {
                      const years = [e.start_year, e.end_year]
                        .filter((y) => y !== null && y !== undefined)
                        .join(" – ");
                      const degree = [e.degree, e.field_of_study].filter(Boolean).join(", ");
                      return (
                        <Entry key={`edu-${i}`}>
                          <EntryHead title={e.institution ?? "Education"} meta={years || null} />
                          {degree ? (
                            <p className="mt-0.5 text-[13.5px] text-body">{degree}</p>
                          ) : null}
                          <Lines label="Achievements" value={e.achievements} />
                        </Entry>
                      );
                    })}
                  </div>
                </Section>
              ) : null}

              {skillEntries.length ? (
                <Section title="Skills">
                  <div className="flex flex-wrap gap-2">
                    {skillEntries.map((s, i) => {
                      const meta = [
                        typeof s.years === "number" ? `${s.years} yrs` : null,
                        s.level,
                      ]
                        .filter(Boolean)
                        .join(" · ");
                      return (
                        <span className="tag" key={`${s.name}-${i}`}>
                          {s.name}
                          {meta ? <span className="text-muted font-normal">· {meta}</span> : null}
                        </span>
                      );
                    })}
                  </div>
                </Section>
              ) : null}

              {summary ? (
                <Section title="Summary">
                  <Markdownish text={summary} />
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="meta-chip">AI-generated</span>
                    {bundle.profile?.updated_at ? (
                      <span className="field-hint">
                        Updated {String(bundle.profile.updated_at).slice(0, 10)}
                      </span>
                    ) : null}
                  </div>
                </Section>
              ) : null}
            </div>

            <aside className="grid gap-5 lg:sticky lg:top-24">
              <div className="rounded-2xl bg-surface shadow-soft-md p-6">
                <p className="text-[14px] leading-[1.6] text-body">Hiring for something like this?</p>
                <Link href="/hire/search" className="btn btn-primary btn-sm press mt-3.5">
                  Run a search <ArrowIcon />
                </Link>
              </div>
            </aside>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
