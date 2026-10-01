"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  Info,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { candidateSchema, toFieldErrors } from "@/lib/validators";
import { SESSION_EVENT } from "@/lib/session-client";
import {
  DOMAINS,
  LOCATIONS,
  SALARY_FREQUENCIES,
} from "@/lib/skills";
import SkillPicker from "@/components/SkillPicker";

type ExpRow = {
  company: string;
  title: string;
  start_date: string;
  end_date: string;
  current: boolean;
  description: string;
  achievements: string;
  tech: string[];
};
type ProjRow = {
  title: string;
  description: string;
  problem: string;
  tech: string[];
  role: string;
  links: { live: string; repo: string; demo: string };
  impact: string;
  users_scale: string;
  hardest_challenge: string;
  personal_contribution: string;
  project_type: string;
};
type EduRow = {
  institution: string;
  degree: string;
  field: string;
  years: string;
  achievements: string;
};
type OssRow = {
  repo_name: string;
  repo_url: string;
  description: string;
  tech: string[];
  role: string;
};

type Draft = {
  name: string;
  email: string;
  phone: string;
  location: string;
  photo_url: string;
  role: string;
  current_role: string;
  headline: string;
  domain: string;
  exp: string;
  skills: string[];
  experiences: ExpRow[];
  projects: ProjRow[];
  oss: OssRow[];
  education: EduRow[];
  links: { github: string; linkedin: string; portfolio: string; resume_url: string };
  min_salary: string;
  currency: string;
  frequency: string;
  negotiable: boolean;
  location_pref: string;
  remote_pref: string;
  relocation: boolean;
  availability: string;
  notice_period: string;
  visibility: string;
  show_email: boolean;
  show_phone: boolean;
  show_linkedin: boolean;
  show_github: boolean;
  show_resume: boolean;
  show_portfolio: boolean;
  show_photo: boolean;
  consent: boolean;
};

type StringKeys<D> = {
  [K in keyof D]: D[K] extends string ? K : never;
}[keyof D];
type BoolKeys<D> = {
  [K in keyof D]: D[K] extends boolean ? K : never;
}[keyof D];

const LS_KEY = "tammy.join.draft.v1";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STEPS = [
  "Basics",
  "Profile",
  "Experience",
  "Projects",
  "Background",
  "Private",
  "Review",
] as const;

const STEP_TITLES: [string, string][] = [
  ["Basics - who you are", "This is how your page introduces you."],
  [
    "Profile - the work you want next",
    "Role, domain, and the skills you get found by.",
  ],
  [
    "Experience - where you've worked",
    "Titles, dates, what you actually did - one card per role.",
  ],
  [
    "Projects - what you've shipped",
    "A couple of real ones beat a list of ten.",
  ],
  [
    "Background - the paper trail",
    "Education and open source - the record behind the work.",
  ],
  [
    "Private - how you're found",
    "Preferences, links, and exactly what employers can see.",
  ],
  ["Review - read it as they will", "One pass before anything enters search."],
];

const STEP_OF_FIELD: Record<string, number> = {
  name: 0,
  email: 0,
  phone: 0,
  location: 0,
  photo_url: 0,
  role: 1,
  current_role: 1,
  headline: 1,
  domain: 1,
  exp: 1,
  skills: 1,
  experiences: 2,
  projects: 3,
  oss: 4,
  education: 4,
  links: 5,
  min_salary: 5,
  currency: 5,
  frequency: 5,
  negotiable: 5,
  location_pref: 5,
  remote_pref: 5,
  relocation: 5,
  availability: 5,
  notice_period: 5,
  visibility: 5,
  show_email: 5,
  show_phone: 5,
  show_linkedin: 5,
  show_github: 5,
  show_resume: 5,
  show_portfolio: 5,
  show_photo: 5,
  consent: 6,
};

const stepOf = (rootKey: string) => STEP_OF_FIELD[rootKey] ?? 6;

const DEFAULT_DRAFT: Draft = {
  name: "",
  email: "",
  phone: "",
  location: "",
  photo_url: "",
  role: "",
  current_role: "",
  headline: "",
  domain: "Software Development",
  exp: "",
  skills: [],
  experiences: [],
  projects: [],
  oss: [],
  education: [],
  links: { github: "", linkedin: "", portfolio: "", resume_url: "" },
  min_salary: "",
  currency: "INR",
  frequency: "monthly",
  negotiable: true,
  location_pref: "",
  remote_pref: "remote",
  relocation: false,
  availability: "Immediate",
  notice_period: "",
  visibility: "visible",
  show_email: false,
  show_phone: false,
  show_linkedin: false,
  show_github: false,
  show_resume: false,
  show_portfolio: false,
  show_photo: false,
  consent: false,
};

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "SGD", "AED", "AUD", "CAD"];

const ROLE_SUGGESTIONS = [
  "Software Engineer",
  "Senior Software Engineer",
  "Staff Engineer",
  "Principal Engineer",
  "Engineering Manager",
  "Frontend Engineer",
  "Backend Engineer",
  "Full Stack Engineer",
  "Mobile Developer",
  "iOS Developer",
  "Android Developer",
  "DevOps Engineer",
  "Site Reliability Engineer",
  "Cloud Engineer",
  "Platform Engineer",
  "Solutions Architect",
  "Technical Architect",
  "Data Engineer",
  "Data Scientist",
  "Machine Learning Engineer",
  "Data Analyst",
  "Business Analyst",
  "Product Manager",
  "Senior Product Manager",
  "Program Manager",
  "Project Manager",
  "Product Designer",
  "UX Designer",
  "UI Designer",
  "QA Engineer",
  "Automation Test Engineer",
  "Security Engineer",
  "Database Administrator",
  "System Administrator",
  "Growth Manager",
  "Marketing Manager",
  "Sales Manager",
  "Content Writer",
  "Customer Success Manager",
  "Research Scientist",
] as const;

const EXP_SUGGESTIONS = [
  "0", "0.5", "1", "1.5", "2", "3", "4", "5", "6", "7", "8", "9", "10",
  "12", "15", "20", "25", "30",
] as const;

const PROJECT_TYPES = [
  { v: "personal", label: "Personal" },
  { v: "academic", label: "Academic" },
  { v: "freelance", label: "Freelance" },
  { v: "production", label: "Production" },
  { v: "open_source", label: "Open source" },
  { v: "prototype", label: "Prototype" },
] as const;

const DEGREE_SUGGESTIONS = [
  "B.E.", "B.Tech", "B.S.", "B.Sc", "BCA", "BBA",
  "M.E.", "M.Tech", "M.S.", "M.Sc", "MCA", "MBA",
  "Ph.D.", "Diploma", "Advanced Diploma",
] as const;

const FIELD_SUGGESTIONS = [
  "Computer Science",
  "Information Technology",
  "Electronics & Communication",
  "Electrical Engineering",
  "Mechanical Engineering",
  "Civil Engineering",
  "Mathematics",
  "Statistics",
  "Data Science",
  "Business Administration",
  "Commerce",
  "Economics",
  "Design",
] as const;

const OSS_ROLES = [
  "Maintainer",
  "Contributor",
  "Core contributor",
  "Owner",
  "Triager",
  "Reviewer",
] as const;

const NOTICE_PERIODS = [
  "No notice period",
  "15 days",
  "30 days",
  "45 days",
  "60 days",
  "90 days",
] as const;

const AVAILABILITY_OPTS = [
  { v: "Immediate", label: "Immediate" },
  { v: "Within 15 days", label: "15 days" },
  { v: "Within 30 days", label: "30 days" },
  { v: "Within 60 days", label: "60 days" },
  { v: "After 90 days", label: "90+ days" },
] as const;

const WORK_MODE_OPTS = [
  { v: "remote", label: "Remote" },
  { v: "hybrid", label: "Hybrid" },
  { v: "onsite", label: "On-site" },
] as const;

const SKILL_SUGGESTIONS = [
  "JavaScript",
  "TypeScript",
  "React",
  "Next.js",
  "Node.js",
  "Python",
  "Java",
  "Go",
  "PostgreSQL",
  "Redis",
  "Docker",
  "Kubernetes",
  "AWS",
  "GraphQL",
  "Figma",
  "Git",
] as const;

const blankExp = (): ExpRow => ({
  company: "",
  title: "",
  start_date: "",
  end_date: "",
  current: false,
  description: "",
  achievements: "",
  tech: [],
});
const blankProj = (): ProjRow => ({
  title: "",
  description: "",
  problem: "",
  tech: [],
  role: "",
  links: { live: "", repo: "", demo: "" },
  impact: "",
  users_scale: "",
  hardest_challenge: "",
  personal_contribution: "",
  project_type: "",
});
const blankEdu = (): EduRow => ({
  institution: "",
  degree: "",
  field: "",
  years: "",
  achievements: "",
});
const blankOss = (): OssRow => ({
  repo_name: "",
  repo_url: "",
  description: "",
  tech: [],
  role: "Contributor",
});

const SAMPLES: Partial<Draft>[] = [
  {
    name: "Aarav Sharma",
    email: "aarav.sharma@example.com",
    phone: "+91 98765 43210",
    location: "Bengaluru",
  },
  {
    role: "Backend Engineer",
    current_role: "SDE II at Paystream",
    headline: "Payments, ledgers, and the occasional postmortem.",
    domain: "Software Development",
    exp: "4",
    skills: ["Node.js", "PostgreSQL", "TypeScript"],
  },
  {
    experiences: [
      {
        company: "Paystream",
        title: "Software Engineer II",
        start_date: "2022-04",
        end_date: "",
        current: true,
        description:
          "Own the double-entry ledger service behind payouts and refunds.",
        achievements:
          "Cut reconciliation time from hours to minutes\nLed the migration off the legacy jobs queue",
        tech: ["Node.js", "PostgreSQL", "Redis"],
      },
    ],
  },
  {
    projects: [
      {
        title: "Ledger reconciliation engine",
        description:
          "Nightly reconciliation across payment rails, with a ruled replays for drifted rows.",
        problem: "Settlement drift appeared days late and nobody could trace it.",
        tech: ["Node.js", "PostgreSQL"],
        role: "Backend owner",
        links: { live: "", repo: "", demo: "" },
        impact: "Drift detected in minutes instead of days.",
        users_scale: "40k accounts",
        hardest_challenge: "Idempotent replays without double-posting entries.",
        personal_contribution: "Schema, worker design, and the alert rules.",
        project_type: "production",
      },
    ],
  },
  {
    education: [
      {
        institution: "Visvesvaraya Technological University",
        degree: "B.E.",
        field: "Computer Science",
        years: "2018 – 2022",
        achievements: "",
      },
    ],
    oss: [
      {
        repo_name: "pg-migrate-lite",
        repo_url: "https://github.com/example/pg-migrate-lite",
        description: "Zero-dependency migration runner for Postgres.",
        tech: ["TypeScript"],
        role: "Maintainer",
      },
    ],
  },
  {
    min_salary: "280000",
    currency: "INR",
    frequency: "monthly",
    location_pref: "Remote",
    remote_pref: "remote",
    availability: "Immediate",
    notice_period: "30 days",
    links: {
      github: "https://github.com/example",
      linkedin: "",
      portfolio: "",
      resume_url: "",
    },
  },
  { consent: true },
];

function fillEmpty(d: Draft, patch: Partial<Draft>): Draft {
  const next: Draft = { ...d, links: { ...d.links } };
  const src = patch as unknown as Record<string, unknown>;
  const dst = next as unknown as Record<string, unknown>;
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (v === undefined || v === null) continue;
    if (k === "links" && typeof v === "object") {
      const lv = v as Draft["links"];
      const lc = next.links;
      next.links = {
        github: lc.github || lv.github || "",
        linkedin: lc.linkedin || lv.linkedin || "",
        portfolio: lc.portfolio || lv.portfolio || "",
        resume_url: lc.resume_url || lv.resume_url || "",
      };
      continue;
    }
    const cur = dst[k];
    if (Array.isArray(v)) {
      if (Array.isArray(cur) && cur.length === 0) dst[k] = v;
      continue;
    }
    if (typeof v === "boolean") {
      if (cur === false) dst[k] = v;
      continue;
    }
    if (typeof v === "string" && typeof cur === "string" && !cur.trim()) {
      dst[k] = v;
    }
  }
  return next;
}

function buildPayload(d: Draft) {
  return {
    name: d.name.trim(),
    email: d.email.trim(),
    phone: d.phone.trim(),
    location: d.location.trim(),
    photo_url: d.photo_url.trim(),
    role: d.role.trim(),
    current_role: d.current_role.trim(),
    headline: d.headline.trim(),
    domain: d.domain,
    exp: Number(d.exp) || 0,
    skills: d.skills,
    experiences: d.experiences,
    projects: d.projects,
    oss: d.oss,
    education: d.education,
    links: {
      github: d.links.github.trim(),
      linkedin: d.links.linkedin.trim(),
      portfolio: d.links.portfolio.trim(),
      resume_url: d.links.resume_url.trim(),
    },
    min_salary: Number(String(d.min_salary).replace(/[^\d.]/g, "")) || 0,
    currency: d.currency,
    frequency: d.frequency,
    negotiable: d.negotiable,
    location_pref: d.location_pref.trim(),
    remote_pref: d.remote_pref,
    relocation: d.relocation,
    availability: d.availability.trim(),
    notice_period: d.notice_period.trim() || undefined,
    visibility: d.visibility,
    show_email: d.show_email,
    show_phone: d.show_phone,
    show_linkedin: d.show_linkedin,
    show_github: d.show_github,
    show_resume: d.show_resume,
    show_portfolio: d.show_portfolio,
    show_photo: d.show_photo,
    consent: d.consent,
  };
}

function fromFlat(errors: unknown): Record<string, string> {
  const fe = (errors as { fieldErrors?: Record<string, string[]> } | null)?.fieldErrors;
  const out: Record<string, string> = {};
  if (fe) for (const [k, v] of Object.entries(fe)) if (Array.isArray(v) && v[0]) out[k] = v[0];
  return out;
}

function F({
  label,
  htmlFor,
  req,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  req?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="field content-start">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
        {req ? (
          <span className="req" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children}
      {hint && !error ? <span className="field-hint">{hint}</span> : null}
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function SegGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { v: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="field content-start">
      <span className="field-label">{label}</span>
      <div className="seg h-[46.5px]" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            className={`seg-btn ${value === o.v ? "is-on" : ""}`}
            aria-pressed={value === o.v}
            onClick={() => onChange(o.v)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function useOutsideDismiss(
  open: boolean,
  ref: { current: HTMLElement | null },
  dismiss: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const el = ref.current;
      const t = e.target;
      if (el && (!(t instanceof Node) || !el.contains(t))) dismiss();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, ref, dismiss]);
}

function PickList({
  listId,
  items,
  active,
  display,
  onHover,
  onPick,
  onOther,
}: {
  listId: string;
  items: readonly string[];
  active: number;
  display?: (v: string) => string;
  onHover: (i: number) => void;
  onPick: (i: number) => void;
  onOther?: () => void;
}) {
  useEffect(() => {
    if (active < 0) return;
    const panel = document.getElementById(listId);
    const el = panel?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    if (!panel || !el) return;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top < panel.scrollTop) panel.scrollTop = top;
    else if (bottom > panel.scrollTop + panel.clientHeight)
      panel.scrollTop = bottom - panel.clientHeight;
  }, [listId, active]);

  return (
    <div
      id={listId}
      role="listbox"
      className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-60 overflow-y-auto rounded-[14px] border border-line bg-surface shadow-soft-md py-1.5"
    >
      {items.length === 0 ? (
        <div
          role="option"
          aria-selected={false}
          className="px-3.5 py-2 text-[13.5px] text-muted"
        >
          No matches
        </div>
      ) : (
        items.map((item, i) => (
          <button
            key={item === "" ? "__empty__" : item}
            type="button"
            role="option"
            id={`${listId}-${i}`}
            data-idx={i}
            aria-selected={i === active}
            tabIndex={-1}
            className={`block w-full cursor-pointer border-0 px-3.5 py-2 text-left text-[14px] leading-[1.45] ${
              i === active ? "bg-inset text-ink" : "bg-transparent text-body"
            }`}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => onHover(i)}
            onClick={() => onPick(i)}
          >
            {display ? display(item) : item}
          </button>
        ))
      )}
      {onOther ? (
        <button
          type="button"
          role="option"
          aria-selected={false}
          tabIndex={-1}
          className="block w-full cursor-pointer border-0 px-3.5 py-2 text-left text-[14px] leading-[1.45] bg-transparent text-muted"
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => onHover(-1)}
          onClick={onOther}
        >
          Other - type my own
        </button>
      ) : null}
    </div>
  );
}

function PickCombo({
  id,
  value,
  options,
  onChange,
  placeholder,
  invalid,
  inputMode,
  maxLength,
}: {
  id: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  placeholder?: string;
  invalid?: boolean;
  inputMode?: "text" | "decimal" | "numeric" | "none" | "search" | "email" | "tel" | "url";
  maxLength?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [free, setFree] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = `${id}-listbox`;

  const q = query.trim().toLowerCase();
  const items = q
    ? options.filter((o) => o.toLowerCase().includes(q))
    : options;
  const ai = items.length ? Math.min(active, items.length - 1) : -1;

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setFree(false);
  }, []);
  useOutsideDismiss(open, wrapRef, close);

  const openList = () => {
    setOpen(true);
    setQuery("");
    setFree(false);
    setActive(0);
  };

  const startOther = () => {
    setFree(true);
    setOpen(false);
    setQuery("");
    setActive(0);
    inputRef.current?.focus();
  };

  const commit = (v: string) => {
    onChange(v);
    close();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const k = e.key;
    if (k === "ArrowDown" || k === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setQuery("");
        setFree(false);
        setActive(k === "ArrowDown" ? 0 : Math.max(0, items.length - 1));
        return;
      }
      if (!items.length) return;
      setActive(
        Math.min(
          Math.max(k === "ArrowDown" ? ai + 1 : ai - 1, 0),
          items.length - 1,
        ),
      );
      return;
    }
    if (k === "Enter") {
      if (open) {
        e.preventDefault();
        if (ai >= 0) commit(items[ai]);
        else startOther();
      } else if (free) {
        e.preventDefault();
      }
      return;
    }
    if (k === "Escape") {
      if (open) {
        e.preventDefault();
        close();
      } else if (free) {
        e.preventDefault();
        setFree(false);
      }
      return;
    }
    if (k === "Tab") close();
  };

  return (
    <div
      className="relative"
      ref={wrapRef}
      onBlur={(e) => {
        const next = e.relatedTarget;
        if (!next || !e.currentTarget.contains(next)) close();
      }}
    >
      <input
        id={id}
        ref={inputRef}
        className="input"
        style={{ paddingRight: 38 }}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={open && ai >= 0 ? `${listId}-${ai}` : undefined}
        aria-invalid={invalid ? true : undefined}
        value={value}
        placeholder={free ? "Type your own…" : placeholder}
        inputMode={inputMode}
        maxLength={maxLength}
        autoComplete="off"
        onFocus={() => {
          if (!open) openList();
        }}
        onClick={() => {
          if (!open) openList();
        }}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v);
          if (free) return;
          setQuery(v);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKey}
      />
      <ChevronDown
        size={16}
        aria-hidden="true"
        className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted"
      />
      {open ? (
        <PickList
          listId={listId}
          items={items}
          active={ai}
          onHover={setActive}
          onPick={(i) => commit(items[i])}
          onOther={startOther}
        />
      ) : null}
    </div>
  );
}

function PickSelect({
  id,
  value,
  options,
  onChange,
  placeholder,
}: {
  id: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const suppressRef = useRef(false);
  const listId = `${id}-listbox`;

  const items: string[] = [
    ...(placeholder !== undefined ? [""] : []),
    ...(value && !options.includes(value) ? [value] : []),
    ...options,
  ];
  const ai = items.length ? Math.min(active, items.length - 1) : -1;

  const close = useCallback(() => setOpen(false), []);
  useOutsideDismiss(open, wrapRef, close);

  const labelOf = (v: string) =>
    v === "" ? (placeholder ?? "Not specified") : v;

  const openAtValue = () => {
    setOpen(true);
    setActive(Math.max(0, items.indexOf(value)));
  };

  const commit = (v: string) => {
    onChange(v);
    close();
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const k = e.key;
    if (k === "ArrowDown" || k === "ArrowUp") {
      suppressRef.current = false;
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(
          k === "ArrowDown"
            ? Math.max(0, items.indexOf(value))
            : Math.max(0, items.length - 1),
        );
        return;
      }
      if (!items.length) return;
      setActive(
        Math.min(
          Math.max(k === "ArrowDown" ? ai + 1 : ai - 1, 0),
          items.length - 1,
        ),
      );
      return;
    }
    if (k === "Enter" || k === " ") {
      if (open) {
        e.preventDefault();
        suppressRef.current = true;
        if (ai >= 0) commit(items[ai]);
        else close();
      } else {
        suppressRef.current = false;
      }
      return;
    }
    suppressRef.current = false;
    if (k === "Escape" && open) {
      e.preventDefault();
      close();
    }
  };

  return (
    <div
      className="relative"
      ref={wrapRef}
      onPointerDown={() => {
        suppressRef.current = false;
      }}
      onBlur={(e) => {
        const next = e.relatedTarget;
        if (!next || !e.currentTarget.contains(next)) close();
      }}
    >
      <button
        id={id}
        type="button"
        role="combobox"
        className="select cursor-pointer text-left"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && ai >= 0 ? `${listId}-${ai}` : undefined}
        onClick={() => {
          if (suppressRef.current) {
            suppressRef.current = false;
            return;
          }
          if (open) close();
          else openAtValue();
        }}
        onKeyDown={onKey}
      >
        <span className={`block truncate ${value ? "text-ink" : "text-muted"}`}>
          {value ? value : placeholder ? placeholder : "Select"}
        </span>
      </button>
      {open ? (
        <PickList
          listId={listId}
          items={items}
          active={ai}
          display={labelOf}
          onHover={setActive}
          onPick={(i) => commit(items[i])}
        />
      ) : null}
    </div>
  );
}

function RowShell({
  label,
  onRemove,
  children,
}: {
  label: string;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-inset p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
          {label}
        </span>
        <button type="button" className="btn btn-secondary btn-sm press" onClick={onRemove}>
          <Trash2 size={14} aria-hidden="true" /> Remove
        </button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function ReviewCard({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-inset p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        <button
          type="button"
          className="btn-link"
          onClick={onEdit}
        >
          Edit
        </button>
      </div>
      <div className="mt-3 text-[14px] leading-[1.55] text-body grid gap-1.5">{children}</div>
    </div>
  );
}

export default function JoinWizard() {
  const [draft, setDraft] = useState<Draft>(DEFAULT_DRAFT);
  const draftRef = useRef(draft);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [saveState, setSaveState] = useState<"saving" | "saved">("saved");
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeId, setNoticeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: string; warnings: string[] } | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupMsg, setLookupMsg] = useState<string | null>(null);
  const [claimPending, setClaimPending] = useState<{
    candidateId: string;
    mode: "created" | "exists";
    message: string;
    warnings: string[];
  } | null>(null);
  const [claimPassword, setClaimPassword] = useState("");
  const [claimConfirm, setClaimConfirm] = useState("");
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimErr, setClaimErr] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Draft> | null;
        if (parsed && typeof parsed === "object") {
          const restored: Draft = {
            ...DEFAULT_DRAFT,
            ...parsed,
            links: { ...DEFAULT_DRAFT.links, ...(parsed.links ?? {}) },
          };
          draftRef.current = restored;
          setDraft(restored);
        }
      }
    } catch {
    }
    setHydrated(true);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const cardRef = useRef<HTMLDivElement>(null);
  const prevStep = useRef(step);
  useEffect(() => {
    if (prevStep.current === step) return;
    prevStep.current = step;
    const el = cardRef.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({
      top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - 76),
      behavior: reduce ? "auto" : "smooth",
    });
  }, [step]);

  const update = (fn: (d: Draft) => Draft) => {
    const next = fn(draftRef.current);
    draftRef.current = next;
    setDraft(next);
    setSaveState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(draftRef.current));
      } catch {
      }
      setSaveState("saved");
    }, 400);
  };

  const str =
    <K extends StringKeys<Draft>>(k: K) =>
    (e: { target: { value: string } }) =>
      update((d) => ({ ...d, [k]: e.target.value }));
  const bool =
    <K extends BoolKeys<Draft>>(k: K) =>
    (e: { target: { checked: boolean } }) =>
      update((d) => ({ ...d, [k]: e.target.checked }));
  const link =
    (k: keyof Draft["links"]) =>
    (e: { target: { value: string } }) =>
      update((d) => ({ ...d, links: { ...d.links, [k]: e.target.value } }));
  const pick =
    <K extends StringKeys<Draft>>(k: K) =>
    (v: string) =>
      update((d) => ({ ...d, [k]: v }));

  const clearErr = (key: string) =>
    setErrs((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });

  const toggleSkill = (s: string) => {
    update((d) =>
      d.skills.some((x) => x.toLowerCase() === s.toLowerCase())
        ? { ...d, skills: d.skills.filter((x) => x.toLowerCase() !== s.toLowerCase()) }
        : { ...d, skills: [...d.skills, s] },
    );
    clearErr("skills");
  };

  const addExp = () => update((d) => ({ ...d, experiences: [...d.experiences, blankExp()] }));
  const dropExp = (i: number) =>
    update((d) => ({ ...d, experiences: d.experiences.filter((_, j) => j !== i) }));
  const onExp =
    (i: number, k: keyof ExpRow) =>
    (e: { target: { value: string } }) => {
      const v = e.target.value;
      update((d) => ({
        ...d,
        experiences: d.experiences.map((r, j) =>
          j === i ? Object.assign({}, r, { [k]: v }) : r,
        ),
      }));
    };
  const onExpBool =
    (i: number) =>
    (e: { target: { checked: boolean } }) => {
      const v = e.target.checked;
      update((d) => ({
        ...d,
        experiences: d.experiences.map((r, j) =>
          j === i ? Object.assign({}, r, { current: v }) : r,
        ),
      }));
    };
  const onExpTech = (i: number, v: string[]) =>
    update((d) => ({
      ...d,
      experiences: d.experiences.map((r, j) => (j === i ? { ...r, tech: v } : r)),
    }));

  const addProj = () => update((d) => ({ ...d, projects: [...d.projects, blankProj()] }));
  const dropProj = (i: number) =>
    update((d) => ({ ...d, projects: d.projects.filter((_, j) => j !== i) }));
  const onProj =
    (i: number, k: keyof ProjRow) =>
    (e: { target: { value: string } }) => {
      const v = e.target.value;
      update((d) => ({
        ...d,
        projects: d.projects.map((r, j) => (j === i ? Object.assign({}, r, { [k]: v }) : r)),
      }));
    };
  const onProjLink = (i: number, k: keyof ProjRow["links"]) =>
    (e: { target: { value: string } }) => {
      const v = e.target.value;
      update((d) => ({
        ...d,
        projects: d.projects.map((r, j) =>
          j === i ? { ...r, links: { ...r.links, [k]: v } } : r,
        ),
      }));
    };
  const onProjTech = (i: number, v: string[]) =>
    update((d) => ({
      ...d,
      projects: d.projects.map((r, j) => (j === i ? { ...r, tech: v } : r)),
    }));

  const addEdu = () => update((d) => ({ ...d, education: [...d.education, blankEdu()] }));
  const dropEdu = (i: number) =>
    update((d) => ({ ...d, education: d.education.filter((_, j) => j !== i) }));
  const onEdu =
    (i: number, k: keyof EduRow) =>
    (e: { target: { value: string } }) => {
      const v = e.target.value;
      update((d) => ({
        ...d,
        education: d.education.map((r, j) => (j === i ? Object.assign({}, r, { [k]: v }) : r)),
      }));
    };

  const addOss = () => update((d) => ({ ...d, oss: [...d.oss, blankOss()] }));
  const dropOss = (i: number) =>
    update((d) => ({ ...d, oss: d.oss.filter((_, j) => j !== i) }));
  const onOss =
    (i: number, k: keyof OssRow) =>
    (e: { target: { value: string } }) => {
      const v = e.target.value;
      update((d) => ({
        ...d,
        oss: d.oss.map((r, j) => (j === i ? Object.assign({}, r, { [k]: v }) : r)),
      }));
    };
  const onOssTech = (i: number, v: string[]) =>
    update((d) => ({ ...d, oss: d.oss.map((r, j) => (j === i ? { ...r, tech: v } : r)) }));

  const autofill = () =>
    update((d) => fillEmpty(d, SAMPLES[step] ?? {}));

  const lookup = async () => {
    const email = draftRef.current.email.trim();
    if (!EMAIL_RE.test(email) || lookupBusy) return;
    setLookupBusy(true);
    setLookupMsg(null);
    try {
      const res = await fetch("/api/candidates/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = (await res.json().catch(() => null)) as {
        exists?: unknown;
        error?: string;
      } | null;
      if (res.status === 429) {
        setLookupMsg("Too many checks in a short window - try again shortly.");
        return;
      }
      if (!res.ok) {
        setLookupMsg(body?.error ?? "Lookup failed - try again.");
        return;
      }
      if (body?.exists === true) {
        setLookupMsg(
          "A visible page already exists for this email - publishing hands control of it back to you.",
        );
      } else {
        setLookupMsg("No page yet for this email - you are clear to publish.");
      }
    } catch {
      setLookupMsg("Network error - try again.");
    } finally {
      setLookupBusy(false);
    }
  };

  const parseNow = () => {
    const parsed = candidateSchema.safeParse(buildPayload(draftRef.current));
    const map = parsed.success ? {} : toFieldErrors(parsed.error);
    setErrs(map);
    return map;
  };

  /** Open the password-claim step after publish (no network round trip). */
  const startClaim = (
    candidateId: string,
    mode: "created" | "exists",
    message: string,
    warnings: string[],
  ) => {
    setClaimPending({ candidateId, mode, message, warnings });
    setClaimPassword("");
    setClaimConfirm("");
    setClaimErr(null);
  };

  const submitClaim = async () => {
    if (!claimPending || claimBusy) return;
    const email = draftRef.current.email.trim();
    if (claimPassword.length < 8) {
      setClaimErr("Password must be at least 8 characters.");
      return;
    }
    if (claimPassword.length > 200) {
      setClaimErr("Password must be at most 200 characters.");
      return;
    }
    if (claimPassword !== claimConfirm) {
      setClaimErr("Passwords do not match.");
      return;
    }
    setClaimBusy(true);
    setClaimErr(null);
    try {
      const res = await fetch("/api/auth/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: claimPassword }),
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: unknown;
        email?: unknown;
        error?: string;
      } | null;
      if (!res.ok || body?.ok !== true) {
        setClaimErr(body?.error ?? "Could not set your password - try again.");
        return;
      }
      const { candidateId, mode, message, warnings } = claimPending;
      setClaimPending(null);
      setClaimPassword("");
      setClaimConfirm("");
      setClaimErr(null);
      window.dispatchEvent(new Event(SESSION_EVENT));
      if (mode === "created") {
        setDone({ id: candidateId, warnings });
        return;
      }
      setNotice(message || "A visible profile already exists for this email.");
      setNoticeId(candidateId);
    } catch {
      setClaimErr("Network error - try again.");
    } finally {
      setClaimBusy(false);
    }
  };

  const publish = async () => {
    setBusy(true);
    setNotice(null);
    setNoticeId(null);
    try {
      const res = await fetch("/api/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(draftRef.current)),
      });
      const body = (await res.json().catch(() => null)) as {
        candidateId?: string;
        warnings?: string[];
        error?: string;
        errors?: unknown;
      } | null;

      if (res.status === 400 && body?.errors) {
        const map = fromFlat(body.errors);
        setErrs(map);
        const keys = Object.keys(map);
        if (keys.length) {
          setDir(-1);
          setStep(stepOf(keys[0].split(".")[0]));
        }
        setNotice("Fix the highlighted fields.");
        return;
      }
      if (res.status === 429) {
        setNotice(
          "Submission rate limit - wait a couple of minutes, your draft is safe on this device.",
        );
        return;
      }
      if (res.status === 409 && body?.candidateId) {
        startClaim(
          body.candidateId,
          "exists",
          body.error ?? "A visible profile already exists for this email.",
          [],
        );
        return;
      }
      if (res.status === 202 && body?.candidateId) {
        startClaim(
          body.candidateId,
          "created",
          "",
          Array.isArray(body.warnings) ? body.warnings : [],
        );
        return;
      }
      setNotice(body?.error ?? "Publish failed - try again.");
    } catch {
      setNotice("Network error - your draft is safe on this device.");
    } finally {
      setBusy(false);
    }
  };

  const goNext = () => {
    const map = parseNow();
    const mine = Object.keys(map).filter((k) => stepOf(k.split(".")[0]) === step);
    if (mine.length) return;
    if (step < STEPS.length - 1) {
      const next = step + 1;
      setDir(1);
      setStep(next);
      setMaxStep((m) => Math.max(m, next));
      return;
    }
    const keys = Object.keys(map);
    if (keys.length) {
      const target = stepOf(keys[0].split(".")[0]);
      setDir(target < step ? -1 : 1);
      setStep(target);
      return;
    }
    void publish();
  };

  const back = () => {
    setDir(-1);
    setStep((s) => Math.max(0, s - 1));
  };

  const jump = (i: number) => {
    if (i > maxStep) return;
    setDir(i < step ? -1 : 1);
    setStep(i);
  };

  if (done) {
    return (
      <div className="rounded-2xl bg-surface shadow-soft-md p-7 sm:p-10 text-center">
        <div className="w-12 h-12 rounded-full bg-brand-soft text-brand-text grid place-items-center mx-auto">
          <Check size={22} aria-hidden="true" />
        </div>
        <h2 className="mt-4 text-[24px] font-semibold text-ink tracking-[-0.02em]">
          Your page is live.
        </h2>
        <p className="mt-2.5 text-[15px] leading-[1.6] text-body max-w-[46ch] mx-auto">
          {draft.visibility === "visible"
            ? "It is listed for employer searches right away."
            : "It is unlisted - reachable only by direct link."}{" "}
          Change anything later; your draft lives on this device.
        </p>
        {done.warnings.length ? (
          <div className="notice notice-warn mt-5 text-left" role="status">
            <Info aria-hidden="true" />
            <span>
              Published with notes:
              <ul className="list-disc pl-4 mt-1 grid gap-0.5">
                {done.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </span>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-center gap-3 mt-7">
          <Link href={`/talent/${done.id}`} className="btn btn-primary press">
            View your page <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <button
            type="button"
            className="btn btn-secondary press"
            onClick={() => {
              setDone(null);
              setStep(STEPS.length - 1);
            }}
          >
            Back to review
          </button>
        </div>
      </div>
    );
  }

  const renderStep = (): ReactNode => {
    switch (step) {
      case 0:
        return (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <F label="Full name" htmlFor="j-name" req error={errs.name}>
                <input
                  id="j-name"
                  className="input"
                  value={draft.name}
                  onChange={str("name")}
                  placeholder="Aarav Sharma"
                  autoComplete="name"
                  aria-invalid={errs.name ? true : undefined}
                />
              </F>
              <F
                label="Email"
                htmlFor="j-email"
                req
                error={errs.email}
                hint="Becomes your contact email automatically."
              >
                <input
                  id="j-email"
                  className="input"
                  type="email"
                  value={draft.email}
                  onChange={str("email")}
                  placeholder="you@example.com"
                  autoComplete="email"
                  aria-invalid={errs.email ? true : undefined}
                />
              </F>
              <F label="Phone" htmlFor="j-phone" error={errs.phone} hint="Optional.">
                <input
                  id="j-phone"
                  className="input"
                  type="tel"
                  value={draft.phone}
                  onChange={str("phone")}
                  placeholder="+91 98765 43210"
                />
              </F>
              <F label="City" htmlFor="j-loc" req error={errs.location}>
                <PickCombo
                  id="j-loc"
                  value={draft.location}
                  options={LOCATIONS}
                  onChange={pick("location")}
                  placeholder="Bengaluru"
                  invalid={!!errs.location}
                />
              </F>
              <div className="sm:col-span-2">
                <F
                  label="Photo URL"
                  htmlFor="j-photo"
                  error={errs.photo_url}
                  hint="Direct image link - shown as your avatar."
                >
                  <input
                    id="j-photo"
                    className="input"
                    type="url"
                    value={draft.photo_url}
                    onChange={str("photo_url")}
                    placeholder="https://…"
                  />
                </F>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 mt-5 pt-5 border-t border-line">
              <button
                type="button"
                className="btn btn-secondary btn-sm press"
                onClick={() => void lookup()}
                disabled={lookupBusy || !EMAIL_RE.test(draft.email.trim())}
              >
                {lookupBusy ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Search size={14} aria-hidden="true" />
                )}
                Check for an existing page
              </button>
              {lookupMsg ? (
                <p className="text-[13.5px] text-body">
                  {lookupMsg}
                </p>
              ) : (
                <span className="field-hint">
                  Publishing twice for the same email returns the existing page to you.
                </span>
              )}
            </div>
          </>
        );

      case 1:
        return (
          <div className="grid gap-4 sm:grid-cols-2">
            <F label="Desired role" htmlFor="p-role" req error={errs.role}>
              <PickCombo
                id="p-role"
                value={draft.role}
                options={ROLE_SUGGESTIONS}
                onChange={pick("role")}
                placeholder="Backend Engineer"
                invalid={!!errs.role}
              />
            </F>
            <F
              label="Current role"
              htmlFor="p-current"
              hint="Optional - shown under your name."
            >
              <PickCombo
                id="p-current"
                value={draft.current_role}
                options={ROLE_SUGGESTIONS}
                onChange={pick("current_role")}
                placeholder="SDE II at Paystream"
              />
            </F>
            <F label="Domain" htmlFor="p-domain" req error={errs.domain}>
              <select
                id="p-domain"
                className="select"
                value={draft.domain}
                onChange={str("domain")}
              >
                {DOMAINS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </F>
            <F
              label="Years of experience"
              htmlFor="p-exp"
              error={errs.exp}
              hint="0 – 50."
            >
              <PickCombo
                id="p-exp"
                value={draft.exp}
                options={EXP_SUGGESTIONS}
                onChange={pick("exp")}
                placeholder="4"
                inputMode="decimal"
                invalid={!!errs.exp}
              />
            </F>
            <div className="sm:col-span-2">
              <F
                label="Headline"
                htmlFor="p-headline"
                hint="One line about what you are about. Max 220 characters."
              >
                <input
                  id="p-headline"
                  className="input"
                  value={draft.headline}
                  onChange={str("headline")}
                  maxLength={220}
                  placeholder="Payments, ledgers, and the occasional postmortem."
                />
              </F>
            </div>
            <div className="sm:col-span-2">
              <SkillPicker
                id="p-skills"
                label="Skills"
                required
                hint="The terms employers search by - normalized to canonical names."
                placeholder="+ Add skill…"
                error={errs.skills}
                value={draft.skills}
                onChange={(v) => {
                  update((d) => ({ ...d, skills: v }));
                  clearErr("skills");
                }}
              />
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted mr-1">
                  Suggestions
                </span>
                {SKILL_SUGGESTIONS.map((s) => {
                  const on = draft.skills.some(
                    (x) => x.toLowerCase() === s.toLowerCase(),
                  );
                  return (
                    <button
                      key={s}
                      type="button"
                      className={`chip-toggle ${on ? "is-on" : ""}`}
                      aria-pressed={on}
                      onClick={() => toggleSkill(s)}
                    >
                      {on ? null : <span aria-hidden="true">+</span>}
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        );

      case 2:
        return (
          <>
            {draft.experiences.length === 0 ? (
              <div className="empty-note">
                No roles added yet - add one, or continue if your path is still
                taking shape.
              </div>
            ) : (
              <div className="grid gap-5">
                {draft.experiences.map((row, i) => (
                  <RowShell
                    key={`exp-${i}`}
                    label={`Role ${i + 1}`}
                    onRemove={() => dropExp(i)}
                  >
                    <F
                      label="Company"
                      htmlFor={`exp-${i}-company`}
                      req
                      error={errs[`experiences.${i}.company`]}
                    >
                      <input
                        id={`exp-${i}-company`}
                        className="input"
                        value={row.company}
                        onChange={onExp(i, "company")}
                        placeholder="Paystream"
                      />
                    </F>
                    <F
                      label="Title"
                      htmlFor={`exp-${i}-title`}
                      req
                      error={errs[`experiences.${i}.title`]}
                    >
                      <input
                        id={`exp-${i}-title`}
                        className="input"
                        value={row.title}
                        onChange={onExp(i, "title")}
                        placeholder="Software Engineer II"
                      />
                    </F>
                    <F label="Start" htmlFor={`exp-${i}-start`} hint="2022-04 or Apr 2022.">
                      <input
                        id={`exp-${i}-start`}
                        className="input"
                        value={row.start_date}
                        onChange={onExp(i, "start_date")}
                        placeholder="2022-04"
                      />
                    </F>
                    <F label="End" htmlFor={`exp-${i}-end`} hint="Blank if current.">
                      <input
                        id={`exp-${i}-end`}
                        className="input"
                        value={row.end_date}
                        onChange={onExp(i, "end_date")}
                        placeholder="2025-01"
                        disabled={row.current}
                      />
                    </F>
                    <label className="check sm:col-span-2">
                      <input type="checkbox" checked={row.current} onChange={onExpBool(i)} />
                      <span>I still work here</span>
                    </label>
                    <div className="sm:col-span-2">
                      <F label="What you did" htmlFor={`exp-${i}-desc`}>
                        <textarea
                          id={`exp-${i}-desc`}
                          className="textarea"
                          value={row.description}
                          onChange={onExp(i, "description")}
                          maxLength={4000}
                        />
                      </F>
                    </div>
                    <div className="sm:col-span-2">
                      <F
                        label="Achievements"
                        htmlFor={`exp-${i}-ach`}
                        hint="One per line."
                      >
                        <textarea
                          id={`exp-${i}-ach`}
                          className="textarea"
                          value={row.achievements}
                          onChange={onExp(i, "achievements")}
                          maxLength={4000}
                        />
                      </F>
                    </div>
                    <div className="sm:col-span-2">
                      <SkillPicker
                        id={`exp-${i}-tech`}
                        label="Tech used"
                        placeholder="+ Add tech…"
                        value={row.tech}
                        onChange={(v) => onExpTech(i, v)}
                      />
                    </div>
                  </RowShell>
                ))}
              </div>
            )}
            <button type="button" className="btn btn-secondary press mt-4" onClick={addExp}>
              <Plus size={16} aria-hidden="true" /> Add role
            </button>
          </>
        );

      case 3:
        return (
          <>
            {draft.projects.length === 0 ? (
              <div className="empty-note">
                No projects yet - one real project with your part spelled out
                does more than a list of ten.
              </div>
            ) : (
              <div className="grid gap-5">
                {draft.projects.map((row, i) => (
                  <RowShell
                    key={`proj-${i}`}
                    label={`Project ${i + 1}`}
                    onRemove={() => dropProj(i)}
                  >
                    <F
                      label="Title"
                      htmlFor={`proj-${i}-title`}
                      req
                      error={errs[`projects.${i}.title`]}
                    >
                      <input
                        id={`proj-${i}-title`}
                        className="input"
                        value={row.title}
                        onChange={onProj(i, "title")}
                        placeholder="Ledger reconciliation engine"
                      />
                    </F>
                    <F label="Your role" htmlFor={`proj-${i}-role`}>
                      <input
                        id={`proj-${i}-role`}
                        className="input"
                        value={row.role}
                        onChange={onProj(i, "role")}
                        placeholder="Backend owner"
                      />
                    </F>
                    <div className="sm:col-span-2">
                      <F
                        label="Description"
                        htmlFor={`proj-${i}-desc`}
                        req
                        error={errs[`projects.${i}.description`]}
                      >
                        <textarea
                          id={`proj-${i}-desc`}
                          className="textarea"
                          value={row.description}
                          onChange={onProj(i, "description")}
                          maxLength={4000}
                          placeholder="What it does and why it mattered."
                        />
                      </F>
                    </div>
                    <div className="sm:col-span-2">
                      <F label="Problem it solved" htmlFor={`proj-${i}-problem`}>
                        <textarea
                          id={`proj-${i}-problem`}
                          className="textarea"
                          value={row.problem}
                          onChange={onProj(i, "problem")}
                          maxLength={2000}
                        />
                      </F>
                    </div>
                    <F label="Project type" htmlFor={`proj-${i}-type`} hint="Personal, academic, freelance, production, open source, prototype.">
                      <select
                        id={`proj-${i}-type`}
                        className="select"
                        value={row.project_type}
                        onChange={onProj(i, "project_type")}
                      >
                        <option value="">Not specified</option>
                        {PROJECT_TYPES.map((t) => (
                          <option key={t.v} value={t.v}>
                            {t.label}
                          </option>
                        ))}
                        {row.project_type &&
                        !PROJECT_TYPES.some((t) => t.v === row.project_type) ? (
                          <option value={row.project_type}>
                            {row.project_type}
                          </option>
                        ) : null}
                      </select>
                    </F>
                    <div className="sm:col-span-2">
                      <SkillPicker
                        id={`proj-${i}-tech`}
                        label="Tech"
                        value={row.tech}
                        onChange={(v) => onProjTech(i, v)}
                        placeholder="Add tech…"
                      />
                    </div>
                    <div className="sm:col-span-2 grid gap-3 sm:grid-cols-3">
                      <F label="Live URL" htmlFor={`proj-${i}-live`} error={errs[`projects.${i}.links.live`]}>
                        <input
                          id={`proj-${i}-live`}
                          className="input"
                          value={row.links.live}
                          onChange={onProjLink(i, "live")}
                          placeholder="https://…"
                        />
                      </F>
                      <F label="Repo URL" htmlFor={`proj-${i}-repo`} error={errs[`projects.${i}.links.repo`]}>
                        <input
                          id={`proj-${i}-repo`}
                          className="input"
                          value={row.links.repo}
                          onChange={onProjLink(i, "repo")}
                          placeholder="https://…"
                        />
                      </F>
                      <F label="Demo URL" htmlFor={`proj-${i}-demo`} error={errs[`projects.${i}.links.demo`]}>
                        <input
                          id={`proj-${i}-demo`}
                          className="input"
                          value={row.links.demo}
                          onChange={onProjLink(i, "demo")}
                          placeholder="https://…"
                        />
                      </F>
                    </div>
                    <div className="sm:col-span-2">
                      <details className="judge">
                        <summary>
                          Impact &amp; detail <ChevronRightPlaceholder />
                        </summary>
                        <div className="grid gap-4 mt-4">
                          <F label="Impact" htmlFor={`proj-${i}-impact`}>
                            <textarea
                              id={`proj-${i}-impact`}
                              className="textarea"
                              value={row.impact}
                              onChange={onProj(i, "impact")}
                              maxLength={2000}
                            />
                          </F>
                          <F label="Users / scale" htmlFor={`proj-${i}-scale`} hint="40k MAU, 12 teams…">
                            <input
                              id={`proj-${i}-scale`}
                              className="input"
                              value={row.users_scale}
                              onChange={onProj(i, "users_scale")}
                              placeholder="40k accounts"
                            />
                          </F>
                          <F label="Hardest challenge" htmlFor={`proj-${i}-hard`}>
                            <textarea
                              id={`proj-${i}-hard`}
                              className="textarea"
                              value={row.hardest_challenge}
                              onChange={onProj(i, "hardest_challenge")}
                              maxLength={2000}
                            />
                          </F>
                          <F label="Your contribution" htmlFor={`proj-${i}-contrib`}>
                            <textarea
                              id={`proj-${i}-contrib`}
                              className="textarea"
                              value={row.personal_contribution}
                              onChange={onProj(i, "personal_contribution")}
                              maxLength={2000}
                            />
                          </F>
                        </div>
                      </details>
                    </div>
                  </RowShell>
                ))}
              </div>
            )}
            <button type="button" className="btn btn-secondary press mt-4" onClick={addProj}>
              <Plus size={16} aria-hidden="true" /> Add project
            </button>
          </>
        );

      case 4:
        return (
          <div className="grid gap-8">
            <div>
              <h3 className="text-[15.5px] font-semibold text-ink mb-4">Education</h3>
              {draft.education.length === 0 ? (
                <div className="empty-note">No entries yet - safe to skip.</div>
              ) : (
                <div className="grid gap-5">
                  {draft.education.map((row, i) => (
                    <RowShell
                      key={`edu-${i}`}
                      label={`Education ${i + 1}`}
                      onRemove={() => dropEdu(i)}
                    >
                      <F
                        label="Institution"
                        htmlFor={`edu-${i}-inst`}
                        req
                        error={errs[`education.${i}.institution`]}
                      >
                        <input
                          id={`edu-${i}-inst`}
                          className="input"
                          value={row.institution}
                          onChange={onEdu(i, "institution")}
                          placeholder="Visvesvaraya Technological University"
                        />
                      </F>
                      <F label="Degree" htmlFor={`edu-${i}-deg`}>
                        <PickSelect
                          id={`edu-${i}-deg`}
                          value={row.degree}
                          options={DEGREE_SUGGESTIONS}
                          onChange={(v) =>
                            onEdu(i, "degree")({ target: { value: v } })
                          }
                          placeholder="Not specified"
                        />
                      </F>
                      <F label="Field" htmlFor={`edu-${i}-field`}>
                        <PickSelect
                          id={`edu-${i}-field`}
                          value={row.field}
                          options={FIELD_SUGGESTIONS}
                          onChange={(v) =>
                            onEdu(i, "field")({ target: { value: v } })
                          }
                          placeholder="Not specified"
                        />
                      </F>
                      <F label="Years" htmlFor={`edu-${i}-years`} hint="2018 – 2022.">
                        <input
                          id={`edu-${i}-years`}
                          className="input"
                          value={row.years}
                          onChange={onEdu(i, "years")}
                          placeholder="2018 – 2022"
                        />
                      </F>
                      <div className="sm:col-span-2">
                        <F label="Achievements" htmlFor={`edu-${i}-ach`}>
                          <textarea
                            id={`edu-${i}-ach`}
                            className="textarea"
                            value={row.achievements}
                            onChange={onEdu(i, "achievements")}
                            maxLength={2000}
                          />
                        </F>
                      </div>
                    </RowShell>
                  ))}
                </div>
              )}
              <button type="button" className="btn btn-secondary btn-sm press mt-4" onClick={addEdu}>
                <Plus size={14} aria-hidden="true" /> Add education
              </button>
            </div>

            <div>
              <h3 className="text-[15.5px] font-semibold text-ink mb-4">Open source</h3>
              {draft.oss.length === 0 ? (
                <div className="empty-note">No repos yet - safe to skip.</div>
              ) : (
                <div className="grid gap-5">
                  {draft.oss.map((row, i) => (
                    <RowShell
                      key={`oss-${i}`}
                      label={`Repo ${i + 1}`}
                      onRemove={() => dropOss(i)}
                    >
                      <F
                        label="Repo name"
                        htmlFor={`oss-${i}-name`}
                        req
                        error={errs[`oss.${i}.repo_name`]}
                      >
                        <input
                          id={`oss-${i}-name`}
                          className="input"
                          value={row.repo_name}
                          onChange={onOss(i, "repo_name")}
                          placeholder="pg-migrate-lite"
                        />
                      </F>
                      <F label="Role" htmlFor={`oss-${i}-role`} hint="Maintainer, contributor…">
                        <PickSelect
                          id={`oss-${i}-role`}
                          value={row.role}
                          options={OSS_ROLES}
                          onChange={(v) =>
                            onOss(i, "role")({ target: { value: v } })
                          }
                          placeholder="Not specified"
                        />
                      </F>
                      <div className="sm:col-span-2">
                        <F
                          label="Repo URL"
                          htmlFor={`oss-${i}-url`}
                          error={errs[`oss.${i}.repo_url`]}
                        >
                          <input
                            id={`oss-${i}-url`}
                            className="input"
                            value={row.repo_url}
                            onChange={onOss(i, "repo_url")}
                            placeholder="https://github.com/…"
                          />
                        </F>
                      </div>
                      <div className="sm:col-span-2">
                        <F label="What it is" htmlFor={`oss-${i}-desc`}>
                          <textarea
                            id={`oss-${i}-desc`}
                            className="textarea"
                            value={row.description}
                            onChange={onOss(i, "description")}
                            maxLength={4000}
                          />
                        </F>
                      </div>
                      <div className="sm:col-span-2">
                        <SkillPicker
                          id={`oss-${i}-tech`}
                          label="Tech"
                          placeholder="+ Add tech…"
                          value={row.tech}
                          onChange={(v) => onOssTech(i, v)}
                        />
                      </div>
                    </RowShell>
                  ))}
                </div>
              )}
              <button type="button" className="btn btn-secondary btn-sm press mt-4" onClick={addOss}>
                <Plus size={14} aria-hidden="true" /> Add repo
              </button>
            </div>
          </div>
        );

      case 5:
        return (
          <div className="grid gap-8">
            <div>
              <h3 className="text-[15.5px] font-semibold text-ink mb-4">Reachability</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <SegGroup
                  label="Availability"
                  value={draft.availability}
                  options={
                    !draft.availability ||
                    AVAILABILITY_OPTS.some((o) => o.v === draft.availability)
                      ? AVAILABILITY_OPTS
                      : [
                          ...AVAILABILITY_OPTS,
                          { v: draft.availability, label: draft.availability },
                        ]
                  }
                  onChange={(v) => update((d) => ({ ...d, availability: v }))}
                />
                <F label="Notice period" htmlFor="v-notice" hint="Optional.">
                  <PickSelect
                    id="v-notice"
                    value={draft.notice_period}
                    options={NOTICE_PERIODS}
                    onChange={pick("notice_period")}
                    placeholder="Not specified"
                  />
                </F>
                <F label="Salary expectation" htmlFor="v-salary" error={errs.min_salary} hint="Plain number - your period is chosen below.">
                  <input
                    id="v-salary"
                    className="input"
                    inputMode="numeric"
                    value={draft.min_salary}
                    onChange={str("min_salary")}
                    placeholder="280000"
                  />
                </F>
                <div className="grid grid-cols-2 gap-3">
                  <div className="field content-start mb-0">
                    <label className="field-label" htmlFor="v-cur">
                      Currency
                    </label>
                    <select
                      id="v-cur"
                      className="select"
                      value={draft.currency}
                      onChange={str("currency")}
                    >
                      {CURRENCIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field content-start mb-0">
                    <label className="field-label" htmlFor="v-freq">
                      Period
                    </label>
                    <select
                      id="v-freq"
                      className="select"
                      value={draft.frequency}
                      onChange={str("frequency")}
                    >
                      {SALARY_FREQUENCIES.map((f) => (
                        <option key={f} value={f}>
                          {f === "hourly" ? "Hourly" : f === "yearly" ? "Yearly" : "Monthly"}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <F label="Preferred location" htmlFor="v-locref" hint="Type or pick - Remote, Bengaluru…">
                  <PickCombo
                    id="v-locref"
                    value={draft.location_pref}
                    options={LOCATIONS}
                    onChange={pick("location_pref")}
                    placeholder="Remote"
                  />
                </F>
                <SegGroup
                  label="Work mode"
                  value={draft.remote_pref}
                  options={WORK_MODE_OPTS}
                  onChange={(v) => update((d) => ({ ...d, remote_pref: v }))}
                />
                <label className="check">
                  <input type="checkbox" checked={draft.negotiable} onChange={bool("negotiable")} />
                  <span>Salary is negotiable</span>
                </label>
                <label className="check">
                  <input type="checkbox" checked={draft.relocation} onChange={bool("relocation")} />
                  <span>Open to relocating</span>
                </label>
              </div>
            </div>

            <div>
              <h3 className="text-[15.5px] font-semibold text-ink mb-4">Links</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <F label="GitHub" htmlFor="l-gh" error={errs["links.github"]}>
                  <input
                    id="l-gh"
                    className="input"
                    value={draft.links.github}
                    onChange={link("github")}
                    placeholder="https://github.com/you"
                  />
                </F>
                <F label="LinkedIn" htmlFor="l-li" error={errs["links.linkedin"]}>
                  <input
                    id="l-li"
                    className="input"
                    value={draft.links.linkedin}
                    onChange={link("linkedin")}
                    placeholder="https://linkedin.com/in/you"
                  />
                </F>
                <F label="Portfolio" htmlFor="l-pf" error={errs["links.portfolio"]}>
                  <input
                    id="l-pf"
                    className="input"
                    value={draft.links.portfolio}
                    onChange={link("portfolio")}
                    placeholder="https://you.dev"
                  />
                </F>
                <F label="Resume URL" htmlFor="l-rz" error={errs["links.resume_url"]}>
                  <input
                    id="l-rz"
                    className="input"
                    value={draft.links.resume_url}
                    onChange={link("resume_url")}
                    placeholder="https://…"
                  />
                </F>
              </div>
            </div>

            <div>
              <h3 className="text-[15.5px] font-semibold text-ink mb-4">Visibility</h3>
              <div className="grid gap-3">
                {(
                  [
                    ["visible", "Listed in search", "Appears in employer searches and by direct link."],
                    ["hidden", "Unlisted", "Reachable only by direct link - never in searches."],
                  ] as const
                ).map(([value, title, sub]) => (
                  <label
                    key={value}
                    className="flex items-start gap-3 rounded-2xl border border-line p-4 cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="visibility"
                      value={value}
                      checked={draft.visibility === value}
                      onChange={() => update((d) => ({ ...d, visibility: value }))}
                      className="mt-1"
                    />
                    <span>
                      <span className="block text-[14.5px] font-semibold text-ink">{title}</span>
                      <span className="block text-[13.5px] text-muted mt-0.5">{sub}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-[15.5px] font-semibold text-ink mb-2">
                What employers see
              </h3>
              <p className="field-hint mb-4">
                Contact channels stay private until you switch them on.
              </p>
              <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                {(
                  [
                    ["show_email", "Show email"],
                    ["show_phone", "Show phone"],
                    ["show_linkedin", "Show LinkedIn"],
                    ["show_github", "Show GitHub"],
                    ["show_resume", "Show resume"],
                    ["show_portfolio", "Show portfolio"],
                    ["show_photo", "Show photo"],
                  ] as const
                ).map(([k, label]) => (
                  <label className="check" key={k}>
                    <input type="checkbox" checked={draft[k]} onChange={bool(k)} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        );

      default:
        return (
          <div className="grid gap-4 sm:grid-cols-2">
            <ReviewCard title="Basics" onEdit={() => jump(0)}>
              <p>{draft.name || "-"}</p>
              <p>{draft.email || "-"}</p>
              <p>
                {[draft.location, draft.phone].filter(Boolean).join(" · ") || "-"}
              </p>
            </ReviewCard>
            <ReviewCard title="Profile" onEdit={() => jump(1)}>
              <p>
                {[draft.role, draft.domain].filter(Boolean).join(" · ")}
                {draft.exp ? ` · ${draft.exp} yrs` : ""}
              </p>
              {draft.headline ? <p className="text-muted">{draft.headline}</p> : null}
              {draft.skills.length ? (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {draft.skills.map((s) => (
                    <span className="tag" key={s}>
                      {s}
                    </span>
                  ))}
                </div>
              ) : null}
            </ReviewCard>
            <div className="rounded-2xl bg-inset p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[15px] font-semibold text-ink">Record</h3>
                <div className="flex gap-3 text-[13px]">
                  {(["Experience", "Projects", "Background"] as const).map((t, idx) => (
                    <button
                      key={t}
                      type="button"
                      className="underline text-muted hover:text-brand-text transition-colors"
                      onClick={() => jump(idx + 2)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 text-[14px] text-body grid gap-1.5">
                <p>
                  {draft.experiences.length}{" "}
                  {draft.experiences.length === 1 ? "role" : "roles"} ·{" "}
                  {draft.projects.length}{" "}
                  {draft.projects.length === 1 ? "project" : "projects"}
                </p>
                <p>
                  {draft.education.length} education · {draft.oss.length} open-source
                </p>
              </div>
            </div>
            <ReviewCard title="Preferences & links" onEdit={() => jump(5)}>
              <p>
                {draft.remote_pref === "onsite"
                  ? "On-site"
                  : draft.remote_pref === "hybrid"
                    ? "Hybrid"
                    : "Remote"}
                {draft.availability ? ` · ${draft.availability}` : ""}
                {draft.min_salary
                  ? ` · ${draft.currency} ${draft.min_salary} / ${draft.frequency}`
                  : ""}
              </p>
              <p className="text-muted">
                {draft.visibility === "visible" ? "Listed in search" : "Unlisted"} ·{" "}
                {[
                  draft.show_email && "email",
                  draft.show_phone && "phone",
                  draft.show_linkedin && "LinkedIn",
                  draft.show_github && "GitHub",
                  draft.show_resume && "resume",
                  draft.show_portfolio && "portfolio",
                  draft.show_photo && "photo",
                ]
                  .filter(Boolean)
                  .join(", ") || "no contact channels public"}
              </p>
            </ReviewCard>

            <div className="sm:col-span-2 mt-2 pt-5 border-t border-line">
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.consent}
                  onChange={(e) => {
                    bool("consent")(e);
                    clearErr("consent");
                  }}
                />
                <span>
                  I consent to Tammy processing this profile for matching
                  purposes.
                </span>
              </label>
              {errs.consent ? (
                <span className="field-error block mt-2" role="alert">
                  {errs.consent}
                </span>
              ) : null}
            </div>
          </div>
        );
    }
  };

  const [stepTitle, stepSub] = STEP_TITLES[step];

  return (
    <div ref={cardRef} className="rounded-2xl bg-surface shadow-soft-md p-5 sm:p-8">

      <div className="flex items-center justify-between gap-3 mb-5">
        <span
          key={step}
          className="step-count-anim font-mono text-[11.5px] uppercase tracking-[0.14em] text-muted"
        >
          Step {step + 1} of {STEPS.length}
        </span>
        <span className="flex items-center gap-2" title="Draft autosaves on this device">
          <span
            className="pulse-dot inline-block w-2 h-2 rounded-full"
            style={{ background: "var(--success)" }}
            aria-hidden="true"
          />
          <span className="font-mono text-[11.5px] uppercase tracking-[0.14em] text-muted">
            {!hydrated ? "\u00A0" : saveState === "saving" ? "Saving…" : "Autosaved"}
          </span>
        </span>
      </div>

      <div className="stepper mb-7">
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            disabled={i > maxStep}
            onClick={() => jump(i)}
            className={`stepper-item ${i === step ? "is-active" : ""} ${
              i !== step && i < maxStep ? "is-done" : ""
            }`}
            aria-current={i === step ? "step" : undefined}
          >
            <span className="stepper-num">
              {i < step ? <Check size={14} aria-hidden="true" /> : i + 1}
            </span>
            <span>{label}</span>
            <span className="stepper-bar" aria-hidden="true" />
          </button>
        ))}
      </div>

      <div key={step} className={`step-anim${dir === -1 ? " step-anim-back" : ""}`}>
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 mb-5">
          <div>
            <h2 className="text-[clamp(1.35rem,2.6vw,1.75rem)] font-semibold tracking-[-0.02em] text-ink">
              {stepTitle}
            </h2>
            <p className="text-[14.5px] text-muted mt-1.5">{stepSub}</p>
          </div>
          <button
            type="button"
            className="btn-link flex items-center gap-1.5"
            onClick={autofill}
          >
            <Sparkles size={14} aria-hidden="true" /> Autofill test data
          </button>
        </div>

        <div>{renderStep()}</div>
      </div>

      {notice ? (
        <div className="notice notice-warn mt-6" role="status">
          <CircleAlert aria-hidden="true" />
          <span>
            {notice}{" "}
            {noticeId ? (
              <Link
                href={`/talent/${noticeId}`}
                className="underline font-semibold text-body"
              >
                Open your page
              </Link>
            ) : null}
          </span>
        </div>
      ) : null}

      {claimPending ? (
        <div className="notice mt-6" role="status">
          <Info aria-hidden="true" />
          <span className="grid gap-3 w-full">
            <span>
              {claimPending.mode === "created"
                ? "Your page is ready - set a password to finish publishing."
                : "That email already has a page - enter its password to take control."}{" "}
              {`This password signs you back in at ${draft.email.trim()}.`}
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <input
                id="j-claim-password"
                className="input"
                style={{ maxWidth: 220 }}
                type="password"
                value={claimPassword}
                onChange={(e) => {
                  setClaimPassword(e.target.value);
                  setClaimErr(null);
                }}
                placeholder="Password (8+ chars)"
                autoComplete="new-password"
                maxLength={200}
                aria-label="Password"
                aria-invalid={claimErr ? true : undefined}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submitClaim();
                  }
                }}
              />
              <input
                id="j-claim-confirm"
                className="input"
                style={{ maxWidth: 220 }}
                type="password"
                value={claimConfirm}
                onChange={(e) => {
                  setClaimConfirm(e.target.value);
                  setClaimErr(null);
                }}
                placeholder="Confirm password"
                autoComplete="new-password"
                maxLength={200}
                aria-label="Confirm password"
                aria-invalid={claimErr ? true : undefined}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submitClaim();
                  }
                }}
              />
              <button
                type="button"
                className="btn btn-primary btn-sm press"
                disabled={claimBusy}
                onClick={() => void submitClaim()}
              >
                {claimBusy ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                ) : null}
                Set password
              </button>
            </span>
            {claimErr ? (
              <span className="field-error" role="alert">
                {claimErr}
              </span>
            ) : null}
          </span>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 mt-7 pt-5 border-t border-line">
        <div className="flex flex-wrap items-center gap-4">
          {step > 0 ? (
            <button type="button" className="btn btn-secondary press" onClick={back}>
              <ArrowLeft size={16} aria-hidden="true" /> Back
            </button>
          ) : (
            <Link href="/" className="btn btn-secondary press">
              <ArrowLeft size={16} aria-hidden="true" /> Back
            </Link>
          )}
          <span className="field-hint hidden sm:inline">Drafts autosave on this device.</span>
        </div>
        <button
          type="button"
          className="btn btn-primary press"
          onClick={goNext}
          disabled={busy}
        >
          {step < STEPS.length - 1 ? (
            <>
              Continue <ArrowRight size={16} aria-hidden="true" />
            </>
          ) : busy ? (
            <>
              <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Publishing…
            </>
          ) : (
            <>
              Publish my page <ArrowRight size={16} aria-hidden="true" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function ChevronRightPlaceholder() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
