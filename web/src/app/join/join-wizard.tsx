"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  AUTOFILL_DRAFT,
  INITIAL_DRAFT,
  STEPS,
  buildPayload,
  clearDraft,
  emptyEducation,
  emptyExperience,
  emptyOss,
  emptyProject,
  loadDraft,
  parseCandidate,
  payloadErrors,
  saveDraft,
  stepForKey,
  validateAccount,
  validateStep,
  type Draft,
} from "./join-draft";
import {
  CheckField,
  ChipPicker,
  SelectField,
  TextAreaField,
  TextField,
} from "./join-fields";

type StepErrors = Record<string, string>;

type PublishResult = {
  id: string;
  existed: boolean;
  warnings: string[];
};

const STEP_TITLES: Record<number, { title: string; sub: string }> = {
  1: { title: "Basics - who you are", sub: "This is how your page introduces you." },
  2: { title: "Your direction", sub: "Where you want to go next." },
  3: { title: "Your experience", sub: "Roles, wins, and scope." },
  4: { title: "Your projects", sub: "Shipped things you are proud of." },
  5: { title: "Your background", sub: "School, open source, links." },
  6: { title: "Private details", sub: "Only for hiring teams." },
  7: { title: "Your account", sub: "Email, password, publish." },
};

const ROLE_OPTIONS = [
  "Backend Engineer",
  "Frontend Engineer",
  "Full-stack Engineer",
  "Mobile Engineer",
  "DevOps / SRE",
  "Data Engineer",
  "ML Engineer",
  "QA Engineer",
  "Security Engineer",
  "Product Manager",
  "Product Designer",
  "Data Analyst",
  "Engineering Manager",
  "DevRel",
  "Other",
];

const CITIES = [
  "Bengaluru",
  "Hyderabad",
  "Pune",
  "Mumbai",
  "Delhi NCR",
  "Chennai",
  "Ahmedabad",
  "Kolkata",
  "Coimbatore",
  "India (remote)",
  "Remote (India)",
  "Dubai",
  "Singapore",
];

const NOTICE_OPTIONS = [
  { value: "", label: "Not specified" },
  { value: "No notice period", label: "No notice period" },
  { value: "15 days", label: "15 days" },
  { value: "30 days", label: "30 days" },
  { value: "45 days", label: "45 days" },
  { value: "60 days", label: "60 days" },
  { value: "90 days", label: "90 days" },
];

const AVAILABILITY_OPTIONS = [
  { value: "Immediate", label: "Immediate" },
  { value: "Within 15 days", label: "15 days" },
  { value: "Within 30 days", label: "30 days" },
  { value: "Within 60 days", label: "60 days" },
  { value: "After 90 days", label: "90+ days" },
];

const WORK_MODE_OPTIONS = [
  { value: "remote", label: "Remote" },
  { value: "hybrid", label: "Hybrid" },
  { value: "onsite", label: "On-site" },
];

const VISIBILITY_OPTIONS = [
  { value: "visible", label: "Listed in search" },
  { value: "hidden", label: "Unlisted" },
  { value: "inactive", label: "Inactive" },
];

const CURRENCY_OPTIONS = [
  "INR",
  "USD",
  "EUR",
  "GBP",
  "SGD",
  "AED",
  "AUD",
  "CAD",
].map((code) => ({ value: code, label: code }));

const FREQUENCY_OPTIONS = [
  { value: "hourly", label: "Hourly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

const PROJECT_TYPE_OPTIONS = [
  { value: "", label: "Not specified" },
  { value: "personal", label: "Personal" },
  { value: "academic", label: "Academic" },
  { value: "freelance", label: "Freelance" },
  { value: "production", label: "Production" },
  { value: "open_source", label: "Open source" },
  { value: "prototype", label: "Prototype" },
];

const DEGREE_OPTIONS = [
  { value: "", label: "Not specified" },
  { value: "B.E.", label: "B.E." },
  { value: "B.Tech", label: "B.Tech" },
  { value: "B.S.", label: "B.S." },
  { value: "B.Sc", label: "B.Sc" },
  { value: "BCA", label: "BCA" },
  { value: "BBA", label: "BBA" },
  { value: "M.E.", label: "M.E." },
  { value: "M.Tech", label: "M.Tech" },
  { value: "M.S.", label: "M.S." },
  { value: "M.Sc", label: "M.Sc" },
  { value: "MCA", label: "MCA" },
  { value: "MBA", label: "MBA" },
  { value: "Ph.D.", label: "Ph.D." },
  { value: "Diploma", label: "Diploma" },
  { value: "Advanced Diploma", label: "Advanced Diploma" },
];

const OSS_ROLE_OPTIONS = [
  { value: "", label: "Not specified" },
  { value: "Maintainer", label: "Maintainer" },
  { value: "Contributor", label: "Contributor" },
  { value: "Core contributor", label: "Core contributor" },
  { value: "Owner", label: "Owner" },
  { value: "Triager", label: "Triager" },
  { value: "Reviewer", label: "Reviewer" },
];

function withValue(
  options: { value: string; label: string }[],
  value: string,
) {
  if (!value || options.some((option) => option.value === value)) return options;
  return [...options, { value, label: value }];
}

function entryFor(errors: StepErrors, base: string, index: number): StepErrors {
  const out: StepErrors = {};
  const prefix = `${base}.${index}.`;
  for (const [key, message] of Object.entries(errors)) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length).split(".");
    if (rest.length > 1 && /^\d+$/.test(rest[rest.length - 1])) rest.pop();
    out[rest.join(".")] = message;
  }
  return out;
}

export default function JoinWizard() {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(INITIAL_DRAFT);
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState<StepErrors>({});
  const [formError, setFormError] = useState("");
  const [lookupMsg, setLookupMsg] = useState("");
  const [lookupState, setLookupState] = useState<
    "idle" | "checking" | "found" | "missing" | "failed"
  >("idle");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [maxStep, setMaxStep] = useState(1);
  const [hydrated, setHydrated] = useState(false);
  const [published, setPublished] = useState<PublishResult | null>(null);
  const [back, setBack] = useState(false);
  const prevStep = useRef(1);
  const stepRef = useRef(1);
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const stored = loadDraft();
      if (stored) {
        setDraft(stored);
        const restored = Math.min(Math.max(stored.step, 1), STEPS.length);
        setStep(restored);
        prevStep.current = restored;
        setMaxStep(restored);
      }
      setHydrated(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveDraft(draft);
  }, [draft, hydrated]);

  useEffect(() => {
    const element = cardRef.current;
    if (!element) return;
    if (prevStep.current === step) return;
    prevStep.current = step;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const top = element.getBoundingClientRect().top;
    if (top < -8 || top > 120) {
      window.scrollTo({ top: window.scrollY + top - 24, behavior: "smooth" });
    }
  }, [step]);

  const touch = useCallback((...prefixes: string[]) => {
    setErrors((current) => {
      if (Object.keys(current).length === 0) return current;
      const next: StepErrors = {};
      for (const [key, message] of Object.entries(current)) {
        const drop = prefixes.some((prefix) =>
          prefix.endsWith(".")
            ? key.startsWith(prefix)
            : key === prefix || key.startsWith(`${prefix}.`),
        );
        if (!drop) next[key] = message;
      }
      return next;
    });
    setFormError("");
  }, []);

  const edit = useCallback(
    (fn: (draft: Draft) => void, ...prefixes: string[]) => {
      setDraft((current) => {
        const next: Draft = { ...current };
        fn(next);
        return next;
      });
      touch(...prefixes);
    },
    [touch],
  );

  const editField = useCallback(
    (key: string, value: string) => {
      edit((next) => {
        (next as unknown as Record<string, string>)[key] = value;
      }, key);
    },
    [edit],
  );

  const setEntries = useCallback(
    <K extends "experiences" | "projects" | "education" | "oss">(
      field: K,
      fn: (entries: Draft[K]) => Draft[K],
      ...prefixes: string[]
    ) => {
      edit((next) => {
        next[field] = fn([...next[field]] as Draft[K]);
      }, ...prefixes);
    },
    [edit],
  );

  const addEntry = useCallback(
    (
      field: "experiences" | "projects" | "education" | "oss",
      make: () => unknown,
      errorsKey: string,
    ) => {
      edit((next) => {
        (next[field] as unknown[]).push(make());
      }, `${errorsKey}.`);
    },
    [edit],
  );

  const removeEntry = useCallback(
    (
      index: number,
      field: "experiences" | "projects" | "education" | "oss",
      errorsKey: string,
    ) => {
      edit((next) => {
        next[field as "experiences"] = (
          next[field] as unknown[]
        ).filter((_unused, i) => i !== index) as never;
      }, `${errorsKey}.`);
    },
    [edit],
  );

  const goTo = useCallback((target: number) => {
    const clamped = Math.min(Math.max(target, 1), STEPS.length);
    setBack(clamped < stepRef.current);
    setStep(clamped);
    setMaxStep((current) => Math.max(current, clamped));
    setErrors({});
    setFormError("");
  }, []);

  const showDevTools = process.env.NODE_ENV !== "production";
  const autofill = useCallback(() => {
    setDraft((current) => {
      const merged: Draft = { ...current };
      for (const [key, value] of Object.entries(AUTOFILL_DRAFT)) {
        if (key === "step") continue;
        const existing = (merged as unknown as Record<string, unknown>)[key];
        if (Array.isArray(value)) {
          if (!Array.isArray(existing) || existing.length === 0) {
            (merged as unknown as Record<string, unknown>)[key] = value.map(
              (item) =>
                item && typeof item === "object" ? { ...item } : item,
            );
          }
          continue;
        }
        if (typeof value === "boolean") {
          if (existing !== true) {
            (merged as unknown as Record<string, unknown>)[key] = value;
          }
          continue;
        }
        if (typeof value === "string" && existing === "") {
          (merged as unknown as Record<string, unknown>)[key] = value;
        }
      }
      return merged;
    });
    setErrors({});
    setFormError("");
    setLookupMsg("");
    setLookupState("idle");
  }, []);

  const runLookup = useCallback(async () => {
    const email = draft.email.trim();
    if (!email) {
      setLookupState("idle");
      setLookupMsg("");
      return;
    }
    setLookupState("checking");
    setLookupMsg("Checking...");
    try {
      const response = await fetch("/api/candidates/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (response.status === 429) {
        setLookupState("failed");
        setLookupMsg("Too many checks in a short window - try again shortly.");
        return;
      }
      if (!response.ok) {
        setLookupState("failed");
        setLookupMsg("Lookup failed - try again.");
        return;
      }
      const body = (await response.json()) as { found?: boolean };
      if (body.found) {
        setLookupState("found");
        setLookupMsg(
          "A visible page already exists for this email - publishing hands control of it back to you.",
        );
      } else {
        setLookupState("missing");
        setLookupMsg("No page yet for this email - you are clear to publish.");
      }
    } catch {
      setLookupState("failed");
      setLookupMsg("Network error - try again.");
    }
  }, [draft.email]);

  const nextFrom = useCallback(
    (target: number) => {
      const result = validateStep(target, draft);
      if (Object.keys(result).length === 0) {
        goTo(target + 1);
        return;
      }
      setErrors(result);
      setFormError("Please fix the highlighted fields to continue.");
    },
    [draft, goTo],
  );

  const claimAndFinish = useCallback(
    async (
      cid: string,
      result: PublishResult,
      email: string,
      pw: string,
    ) => {
      try {
        const response = await fetch("/api/auth/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password: pw }),
        });
        if (response.ok) {
          clearDraft();
          setPublished(result);
          router.refresh();
          return;
        }
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setPublished(result);
        setFormError(
          `${body?.error ?? "Your page is live, but signing in failed."} Your page is at ${cid} - your draft is safe on this device.`,
        );
      } catch {
        setPublished(result);
        setFormError(
          `Your page is live, but signing in failed. Your page is at ${cid} - your draft is safe on this device.`,
        );
      }
    },
    [router],
  );

  const publish = useCallback(async () => {
    const accountErrors = validateAccount(draft, password, confirm);
    if (Object.keys(accountErrors).length > 0) {
      setErrors(accountErrors);
      setFormError("Please fix the highlighted fields to continue.");
      return;
    }
    const payload = buildPayload(draft);
    const parsed = parseCandidate(draft);
    if (!parsed.success) {
      const bad = payloadErrors(parsed.error);
      const target = stepForKey(Object.keys(bad)[0] ?? "");
      if (target === 7) {
        goTo(7);
        setErrors(accountErrors);
        setFormError(
          "Some details are still incomplete - check the highlighted fields.",
        );
        return;
      }
      const targetErrors = validateStep(target, draft);
      goTo(target);
      setErrors(targetErrors);
      setFormError(
        "Some details are still incomplete - check the highlighted fields.",
      );
      return;
    }
    setPending(true);
    setFormError("");
    try {
      const response = await fetch("/api/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as {
        candidateId?: string;
        pageId?: string;
        id?: string;
        error?: string;
        errors?: Record<string, string>;
        warnings?: string[];
      } | null;
      if (response.status === 400) {
        const serverMap = body?.errors ?? {};
        const first = Object.keys(serverMap)[0] ?? "";
        const target = stepForKey(first);
        const merged: StepErrors = {
          ...validateStep(target, draft),
          ...serverMap,
        };
        setFormError(
          "Some details are still incomplete - check the highlighted fields.",
        );
        goTo(target);
        setErrors(merged);
        return;
      }
      const cid = body?.candidateId ?? body?.pageId ?? body?.id;
      if (response.status === 409 || response.status === 429) {
        if (cid) {
          const result: PublishResult = {
            id: cid,
            existed: response.status === 409,
            warnings: Array.isArray(body?.warnings) ? body.warnings : [],
          };
          await claimAndFinish(cid, result, draft.email, password);
          return;
        }
        setFormError(
          response.status === 429
            ? "Submission rate limit - wait a couple of minutes, your draft is safe on this device."
            : body?.error ?? "Publish failed - try again.",
        );
        return;
      }
      if (!response.ok || !cid) {
        setFormError(body?.error ?? "Publish failed - try again.");
        return;
      }
      const result: PublishResult = {
        id: cid,
        existed: false,
        warnings: Array.isArray(body?.warnings) ? body.warnings : [],
      };
      await claimAndFinish(cid, result, draft.email, password);
    } catch {
      setFormError("Network error - your draft is safe on this device.");
    } finally {
      setPending(false);
    }
  }, [claimAndFinish, confirm, draft, goTo, password]);

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (pending) return;
      if (published) return;
      if (step >= STEPS.length) {
        void publish();
        return;
      }
      nextFrom(step);
    },
    [nextFrom, pending, publish, published, step],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLFormElement>) => {
      if (event.key !== "Enter") return;
      const target = event.target as HTMLElement;
      if (target instanceof HTMLTextAreaElement) return;
      if (target.isContentEditable) return;
      if (target.getAttribute("role") === "combobox") return;
      if (target instanceof HTMLButtonElement) {
        if (target.type === "submit" || target.type === "button") return;
      }
      event.preventDefault();
      if (pending || published) return;
      if (step >= STEPS.length) void publish();
      else nextFrom(step);
    },
    [nextFrom, pending, publish, published, step],
  );

  if (published) {
    return (
      <div
        className="rounded-2xl bg-surface p-5 shadow-soft-md sm:p-8"
        ref={cardRef}
      >
        <div
          className="mb-5 flex h-11 w-11 items-center justify-center rounded-full"
          style={{ background: "var(--success)" }}
        >
          <svg
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="none"
            stroke="#fff"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <h1 className="text-[clamp(1.35rem,2.6vw,1.75rem)] font-semibold tracking-[-0.02em] text-ink">
          Your page is live.
        </h1>
        <p className="mt-1.5 text-[14.5px] text-muted">
          {published.existed
            ? "A page for this email already existed - publishing handed control of it back to you."
            : "Your page starts unlisted - reachable only by direct link. You can update it any time."}
        </p>
        {published.warnings.length > 0 && (
          <div className="notice mt-5" role="status">
            <strong>Worth knowing</strong>
            <ul className="mt-1.5 list-disc pl-5">
              {published.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}
        {formError && (
          <p className="field-error mt-5" role="alert">
            {formError}
          </p>
        )}
        <div className="mt-7 flex flex-wrap items-center gap-3 border-t border-line pt-5">
          <Link href={`/talent/${published.id}`} className="btn btn-primary">
            View your page
          </Link>
          <Link href="/" className="btn btn-secondary">
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  const title = STEP_TITLES[step] ?? STEP_TITLES[1];

  return (
    <div className="rounded-2xl bg-surface p-5 shadow-soft-md sm:p-8">
      <div className="mb-5 flex items-center justify-between gap-3">
        <span className="font-mono text-[11.5px] uppercase tracking-[0.14em] text-muted">
          Step <span className="step-count-anim">{step}</span> of {STEPS.length}
        </span>
        <span
          className="flex items-center gap-2"
          title="Draft autosaves on this device"
        >
          <span
            aria-hidden="true"
            className="pulse-dot inline-block h-2 w-2 rounded-full"
            style={{ background: "var(--success)" }}
          />
          <span className="font-mono text-[11.5px] uppercase tracking-[0.14em] text-muted">
            Autosaved
          </span>
        </span>
      </div>

      <div className="stepper mb-7">
        {STEPS.map((label, index) => {
          const number = index + 1;
          const classes = ["stepper-item"];
          if (number === step) classes.push("is-active");
          else if (number < step) classes.push("is-done");
          const disabled = pending || number > maxStep;
          return (
            <button
              key={label}
              type="button"
              className={classes.join(" ")}
              disabled={disabled}
              aria-current={number === step ? "step" : undefined}
              onClick={() => {
                if (number !== step) goTo(number);
              }}
            >
              <span className="stepper-num" aria-hidden="true">
                {number}
              </span>
              <span>{label}</span>
              <span className="stepper-bar" aria-hidden="true" />
            </button>
          );
        })}
      </div>

      <form noValidate onSubmit={onSubmit} onKeyDown={onKeyDown}>
        <datalist id="join-locations">
          {Array.from(
            new Set(
              CITIES.concat(
                draft.location && !CITIES.includes(draft.location)
                  ? [draft.location]
                  : [],
              ),
            ),
          ).map((city) => (
            <option key={city} value={city} />
          ))}
        </datalist>
        <datalist id="join-roles">
          {ROLE_OPTIONS.map((role) => (
            <option key={role} value={role} />
          ))}
        </datalist>

        <div className={back ? "step-anim step-anim-back" : "step-anim"}>
          <div className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <div>
              <h2 className="text-[clamp(1.35rem,2.6vw,1.75rem)] font-semibold tracking-[-0.02em] text-ink">
                {title.title}
              </h2>
              <p className="mt-1.5 text-[14.5px] text-muted">{title.sub}</p>
            </div>
{showDevTools && (
            <button
              type="button"
              className="btn-link flex items-center gap-1.5"
              onClick={autofill}
            >
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
                <path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" />
                <path d="M20 2v4" />
                <path d="M22 4h-4" />
                <circle cx="4" cy="20" r="2" />
              </svg>
              Autofill test data
            </button>
)}
          </div>

          {renderStep()}

          {formError && (
            <p className="field-error mt-5" role="alert">
              {formError}
            </p>
          )}

          <div className="mt-7 flex items-center justify-between gap-3 border-t border-line pt-5">
            <div className="flex flex-wrap items-center gap-4">
              {step > 1 ? (
                <button
                  type="button"
                  className="btn btn-secondary press"
                  disabled={pending}
                  onClick={() => goTo(step - 1)}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m12 19-7-7 7-7" />
                    <path d="M19 12H5" />
                  </svg>
                  Back
                </button>
              ) : (
                <Link href="/" className="btn btn-secondary press">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m12 19-7-7 7-7" />
                    <path d="M19 12H5" />
                  </svg>
                  Back
                </Link>
              )}
              <span className="field-hint hidden sm:inline">
                Drafts autosave on this device.
              </span>
            </div>
            <button
              type="submit"
              className="btn btn-primary press"
              disabled={pending}
            >
              {pending
                ? "Publishing…"
                : step >= STEPS.length
                  ? "Publish my page"
                  : "Continue"}
              {!pending && step < STEPS.length && (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
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
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );

  function removeButton(
    index: number,
    field: "experiences" | "projects" | "education" | "oss",
    errorsKey: string,
  ) {
    return (
      <button
        type="button"
        className="chip-x"
        disabled={pending}
        onClick={() => removeEntry(index, field, errorsKey)}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
        Remove
      </button>
    );
  }

  function renderStep(): React.ReactNode {
    switch (step) {
      case 1:
        return (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                id="j-name"
                label="Full name"
                required
                value={draft.name}
                onChange={(event) => editField("name", event.target.value)}
                error={errors.name}
                placeholder="Aarav Sharma"
                autoComplete="name"
              />
              <TextField
                id="j-email"
                label="Email"
                required
                hint="Becomes your contact email automatically."
                value={draft.email}
                onChange={(event) => {
                  editField("email", event.target.value);
                  setLookupState("idle");
                  setLookupMsg("");
                }}
                error={errors.email}
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
              />
              <TextField
                id="j-phone"
                label="Phone"
                hint="Optional."
                value={draft.phone}
                onChange={(event) => editField("phone", event.target.value)}
                error={errors.phone}
                type="tel"
                placeholder="+91 98765 43210"
                autoComplete="tel"
              />
              <div className="field content-start">
                <label className="field-label" htmlFor="j-loc">
                  City
                  <span className="req" aria-hidden="true">
                    *
                  </span>
                </label>
                <div className="relative">
                  <input
                    id="j-loc"
                    className="input"
                    style={{ paddingRight: "38px" }}
                    role="combobox"
                    aria-expanded="false"
                    aria-controls="join-locations"
                    aria-autocomplete="list"
                    list="join-locations"
                    placeholder="Bengaluru"
                    autoComplete="address-level2"
                    value={draft.location}
                    onChange={(event) =>
                      editField("location", event.target.value)
                    }
                    aria-invalid={errors.location ? true : undefined}
                  />
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </div>
                {errors.location && (
                  <p className="field-error" role="alert">
                    {errors.location}
                  </p>
                )}
              </div>
              <div className="sm:col-span-2">
                <TextField
                  id="j-photo"
                  label="Photo URL"
                  hint="Direct image link - shown as your avatar."
                  value={draft.photo_url}
                  onChange={(event) =>
                    editField("photo_url", event.target.value)
                  }
                  error={errors.photo_url}
                  type="url"
                  placeholder="https://…"
                />
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-5">
              <button
                type="button"
                className="btn btn-secondary btn-sm press"
                disabled={pending || lookupState === "checking"}
                onClick={() => void runLookup()}
              >
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
                  <path d="m21 21-4.34-4.34" />
                  <circle cx="11" cy="11" r="8" />
                </svg>
                {lookupState === "checking" ? "Checking..." : "Check for an existing page"}
              </button>
              <span className="field-hint">
                Publishing twice for the same email returns the existing page to
                you.
              </span>
            </div>
            {lookupMsg && (
              <p
                className={
                  lookupState === "found" || lookupState === "failed"
                    ? "field-error mt-3"
                    : "field-hint mt-3"
                }
                role="status"
              >
                {lookupMsg}
              </p>
            )}
          </>
        );
      case 2:
        return (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                id="join-role"
                label="Target role"
                required
                value={draft.role}
                onChange={(event) => editField("role", event.target.value)}
                error={errors.role}
                list="join-roles"
                placeholder="Backend Engineer"
              />
              <TextField
                id="join-current-role"
                label="Current role"
                value={draft.current_role}
                onChange={(event) =>
                  editField("current_role", event.target.value)
                }
                error={errors.current_role}
                placeholder="SDE II at Flipkart"
              />
              <TextField
                id="join-headline"
                label="Headline"
                hint="One line that stays pinned under your name."
                value={draft.headline}
                onChange={(event) => editField("headline", event.target.value)}
                error={errors.headline}
                placeholder="Backend engineer who likes boring, reliable systems."
              />
              <TextField
                id="join-domain"
                label="Domain"
                required
                value={draft.domain}
                onChange={(event) => editField("domain", event.target.value)}
                error={errors.domain}
                placeholder="Software Development"
              />
              <TextField
                id="join-exp"
                label="Years of experience"
                value={draft.exp}
                onChange={(event) => editField("exp", event.target.value)}
                error={errors.exp}
                type="number"
                min={0}
                max={50}
                placeholder="3"
              />
            </div>
            <div className="mt-4">
              <ChipPicker
                id="join-skills"
                label="Core skills"
                required
                hint="Up to 10. Type and press Enter, or pick a suggestion."
                values={draft.skills}
                onChange={(next) =>
                  edit((d) => {
                    d.skills = next;
                  }, "skills")
                }
                error={errors.skills}
                placeholder="Type a skill and press Enter"
              />
            </div>
          </>
        );
      case 3:
        return (
          <>
            {draft.experiences.length === 0 && (
              <p className="empty-note">
                No experience added yet - add your first role.
              </p>
            )}
            {draft.experiences.map((experience, index) => {
              const entry = entryFor(errors, "experiences", index);
              return (
                <div
                  className="mb-4 rounded-2xl border border-line p-4 sm:p-5"
                  key={`experience-${index}`}
                >
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <span className="font-mono text-[11.5px] uppercase tracking-[0.14em] text-muted">
                      Experience {index + 1}
                    </span>
                    {removeButton(index, "experiences", "experiences")}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField
                      id={`join-exp-title-${index}`}
                      label="Role"
                      required
                      value={experience.title}
                      onChange={(event) => {
                        const value = event.target.value;
                        setEntries(
                          "experiences",
                          (list) =>
                            list.map((item, i) =>
                              i === index ? { ...item, title: value } : item,
                            ),
                          `experiences.${index}.title`,
                        );
                      }}
                      error={entry.title}
                      placeholder="Backend Engineer"
                    />
                    <TextField
                      id={`join-exp-company-${index}`}
                      label="Company"
                      required
                      value={experience.company}
                      onChange={(event) => {
                        const value = event.target.value;
                        setEntries(
                          "experiences",
                          (list) =>
                            list.map((item, i) =>
                              i === index ? { ...item, company: value } : item,
                            ),
                          `experiences.${index}.company`,
                        );
                      }}
                      error={entry.company}
                      placeholder="Flipkart"
                    />
                    <TextField
                      id={`join-exp-start-${index}`}
                      label="Start"
                      value={experience.start_date}
                      onChange={(event) => {
                        const value = event.target.value;
                        setEntries(
                          "experiences",
                          (list) =>
                            list.map((item, i) =>
                              i === index
                                ? { ...item, start_date: value }
                                : item,
                            ),
                          `experiences.${index}.start_date`,
                        );
                      }}
                      error={entry.start_date}
                      placeholder="Jul 2022"
                    />
                    <TextField
                      id={`join-exp-end-${index}`}
                      label="End"
                      hint="Leave blank if this is your current role."
                      value={experience.end_date}
                      onChange={(event) => {
                        const value = event.target.value;
                        setEntries(
                          "experiences",
                          (list) =>
                            list.map((item, i) =>
                              i === index ? { ...item, end_date: value } : item,
                            ),
                          `experiences.${index}.end_date`,
                        );
                      }}
                      error={entry.end_date}
                      placeholder="Present"
                    />
                    <div className="sm:col-span-2">
                      <TextAreaField
                        id={`join-exp-desc-${index}`}
                        label="What you owned"
                        rows={3}
                        value={experience.description}
                        onChange={(event) => {
                          const value = event.target.value;
                          setEntries(
                            "experiences",
                            (list) =>
                              list.map((item, i) =>
                                i === index
                                  ? { ...item, description: value }
                                  : item,
                              ),
                            `experiences.${index}.description`,
                          );
                        }}
                        error={entry.description}
                        placeholder="Owned checkout APIs at 2k rps; cut p99 from 800ms to 180ms."
                      />
                    </div>
                  </div>
                </div>
              );
            })}
            <div className="mt-4">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={pending}
                onClick={() => addEntry("experiences", emptyExperience, "experiences")}
              >
                <span aria-hidden="true">+</span> Add experience
              </button>
            </div>
          </>
        );
      case 4:
        return (
          <>
            {draft.projects.length === 0 && (
              <p className="empty-note">
                No projects added yet - add something you have shipped.
              </p>
            )}
            {draft.projects.map((project, index) => {
              const entry = entryFor(errors, "projects", index);
              return (
                <div
                  className="mb-4 rounded-2xl border border-line p-4 sm:p-5"
                  key={`project-${index}`}
                >
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <span className="font-mono text-[11.5px] uppercase tracking-[0.14em] text-muted">
                      Project {index + 1}
                    </span>
                    {removeButton(index, "projects", "projects")}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField
                      id={`join-proj-title-${index}`}
                      label="Project name"
                      required
                      value={project.title}
                      onChange={(event) => {
                        const value = event.target.value;
                        setEntries(
                          "projects",
                          (list) =>
                            list.map((item, i) =>
                              i === index ? { ...item, title: value } : item,
                            ),
                          `projects.${index}.title`,
                        );
                      }}
                      error={entry.title}
                      placeholder="Ledgerly"
                    />
                    <SelectField
                      id={`join-proj-type-${index}`}
                      label="Type"
                      value={project.project_type}
                      options={withValue(PROJECT_TYPE_OPTIONS, project.project_type)}
                      onChange={(event) => {
                        const value = event.target.value;
                        setEntries(
                          "projects",
                          (list) =>
                            list.map((item, i) =>
                              i === index
                                ? { ...item, project_type: value }
                                : item,
                            ),
                          `projects.${index}.project_type`,
                        );
                      }}
                      error={entry.project_type}
                    />
                    <TextField
                      id={`join-proj-live-${index}`}
                      label="Live URL"
                      value={project.live}
                      onChange={(event) => {
                        const value = event.target.value;
                        setEntries(
                          "projects",
                          (list) =>
                            list.map((item, i) =>
                              i === index ? { ...item, live: value } : item,
                            ),
                          `projects.${index}.links.live`,
                        );
                      }}
                      error={entry["links.live"]}
                      type="url"
                      placeholder="https://…"
                    />
                    <TextField
                      id={`join-proj-repo-${index}`}
                      label="Repo URL"
                      value={project.repo}
                      onChange={(event) => {
                        const value = event.target.value;
                        setEntries(
                          "projects",
                          (list) =>
                            list.map((item, i) =>
                              i === index ? { ...item, repo: value } : item,
                            ),
                          `projects.${index}.links.repo`,
                        );
                      }}
                      error={entry["links.repo"]}
                      type="url"
                      placeholder="https://github.com/…"
                    />
                    <div className="sm:col-span-2">
                      <TextField
                        id={`join-proj-desc-${index}`}
                        label="One-liner"
                        required
                        value={project.description}
                        onChange={(event) => {
                          const value = event.target.value;
                          setEntries(
                            "projects",
                            (list) =>
                              list.map((item, i) =>
                                i === index
                                  ? { ...item, description: value }
                                  : item,
                              ),
                            `projects.${index}.description`,
                          );
                        }}
                        error={entry.description}
                        placeholder="Invoicing for Indian freelancers, UPI + GST built in."
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <TextAreaField
                        id={`join-proj-problem-${index}`}
                        label="What it solves and your role"
                        rows={3}
                        value={project.problem}
                        onChange={(event) => {
                          const value = event.target.value;
                          setEntries(
                            "projects",
                            (list) =>
                              list.map((item, i) =>
                                i === index ? { ...item, problem: value } : item,
                              ),
                            `projects.${index}.problem`,
                          );
                        }}
                        error={entry.problem}
                        placeholder="Designed the data model, built the API and the React dashboard solo."
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <ChipPicker
                        id={`join-project-stack-${index}`}
                        label="Stack"
                        values={project.tech}
                        onChange={(next) =>
                          setEntries(
                            "projects",
                            (list) =>
                              list.map((item, i) =>
                                i === index ? { ...item, tech: next } : item,
                              ),
                            `projects.${index}.tech`,
                          )
                        }
                        error={entry.tech}
                        placeholder="Type a stack and press Enter"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
            <div className="mt-4">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={pending}
                onClick={() => addEntry("projects", emptyProject, "projects")}
              >
                <span aria-hidden="true">+</span> Add project
              </button>
            </div>
          </>
        );
      case 5:
        return (
          <>
            {draft.education.length === 0 && (
              <p className="empty-note">
                No education added yet - add a degree or bootcamp.
              </p>
            )}
            {draft.education.map((education, index) => {
              const entry = entryFor(errors, "education", index);
              return (
                <div
                  className="mb-4 rounded-2xl border border-line p-4 sm:p-5"
                  key={`education-${index}`}
                >
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <span className="font-mono text-[11.5px] uppercase tracking-[0.14em] text-muted">
                      Education {index + 1}
                    </span>
                    {removeButton(index, "education", "education")}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <SelectField
                      id={`join-edu-degree-${index}`}
                      label="Degree"
                      value={education.degree}
                      options={withValue(DEGREE_OPTIONS, education.degree)}
                      onChange={(event) => {
                        const value = event.target.value;
                        setEntries(
                          "education",
                          (list) =>
                            list.map((item, i) =>
                              i === index ? { ...item, degree: value } : item,
                            ),
                          `education.${index}.degree`,
                        );
                      }}
                      error={entry.degree}
                    />
                    <TextField
                      id={`join-edu-field-${index}`}
                      label="Field of study"
                      value={education.field}
                      onChange={(event) => {
                        const value = event.target.value;
                        setEntries(
                          "education",
                          (list) =>
                            list.map((item, i) =>
                              i === index ? { ...item, field: value } : item,
                            ),
                          `education.${index}.field`,
                        );
                      }}
                      error={entry.field}
                      placeholder="Computer Science"
                    />
                    <TextField
                      id={`join-edu-inst-${index}`}
                      label="Institution"
                      required
                      value={education.institution}
                      onChange={(event) => {
                        const value = event.target.value;
                        setEntries(
                          "education",
                          (list) =>
                            list.map((item, i) =>
                              i === index
                                ? { ...item, institution: value }
                                : item,
                            ),
                          `education.${index}.institution`,
                        );
                      }}
                      error={entry.institution}
                      placeholder="NIT Trichy"
                    />
                    <TextField
                      id={`join-edu-years-${index}`}
                      label="Years"
                      value={education.years}
                      onChange={(event) => {
                        const value = event.target.value;
                        setEntries(
                          "education",
                          (list) =>
                            list.map((item, i) =>
                              i === index ? { ...item, years: value } : item,
                            ),
                          `education.${index}.years`,
                        );
                      }}
                      error={entry.years}
                      placeholder="2019 - 2023"
                    />
                    <div className="sm:col-span-2">
                      <TextField
                        id={`join-edu-grade-${index}`}
                        label="Grade / honors"
                        value={education.achievements}
                        onChange={(event) => {
                          const value = event.target.value;
                          setEntries(
                            "education",
                            (list) =>
                              list.map((item, i) =>
                                i === index
                                  ? { ...item, achievements: value }
                                  : item,
                              ),
                            `education.${index}.achievements`,
                          );
                        }}
                        error={entry.achievements}
                        placeholder="8.7 CGPA"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
            <div className="mt-4">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={pending}
                onClick={() => addEntry("education", emptyEducation, "education")}
              >
                <span aria-hidden="true">+</span> Add education
              </button>
            </div>

            <div className="mt-7">
              <h3 className="text-[17px] font-semibold text-ink">Open source</h3>
              <p className="mt-1 text-[14.5px] text-muted">
                Maintainer work, recurring contributions, PRs you are proud of.
              </p>
            </div>
            {draft.oss.map((oss, index) => {
              const entry = entryFor(errors, "oss", index);
              return (
                <div
                  className="mt-4 rounded-2xl border border-line p-4 sm:p-5"
                  key={`oss-${index}`}
                >
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <span className="font-mono text-[11.5px] uppercase tracking-[0.14em] text-muted">
                      Contribution {index + 1}
                    </span>
                    {removeButton(index, "oss", "oss")}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField
                      id={`join-oss-name-${index}`}
                      label="Project"
                      required
                      value={oss.repo_name}
                      onChange={(event) => {
                        const value = event.target.value;
                        setEntries(
                          "oss",
                          (list) =>
                            list.map((item, i) =>
                              i === index
                                ? { ...item, repo_name: value }
                                : item,
                            ),
                          `oss.${index}.repo_name`,
                        );
                      }}
                      error={entry.repo_name}
                      placeholder="React"
                    />
                    <TextField
                      id={`join-oss-repo-${index}`}
                      label="Repo URL"
                      value={oss.repo_url}
                      onChange={(event) => {
                        const value = event.target.value;
                        setEntries(
                          "oss",
                          (list) =>
                            list.map((item, i) =>
                              i === index ? { ...item, repo_url: value } : item,
                            ),
                          `oss.${index}.repo_url`,
                        );
                      }}
                      error={entry.repo_url}
                      type="url"
                      placeholder="https://github.com/…"
                    />
                    <SelectField
                      id={`join-oss-role-${index}`}
                      label="Role"
                      value={oss.role}
                      options={withValue(OSS_ROLE_OPTIONS, oss.role)}
                      onChange={(event) => {
                        const value = event.target.value;
                        setEntries(
                          "oss",
                          (list) =>
                            list.map((item, i) =>
                              i === index ? { ...item, role: value } : item,
                            ),
                          `oss.${index}.role`,
                        );
                      }}
                      error={entry.role}
                    />
                    <TextField
                      id={`join-oss-pr-${index}`}
                      label="Pull request URL"
                      value={oss.pr_links}
                      onChange={(event) => {
                        const value = event.target.value;
                        setEntries(
                          "oss",
                          (list) =>
                            list.map((item, i) =>
                              i === index ? { ...item, pr_links: value } : item,
                            ),
                          `oss.${index}.pr_links`,
                        );
                      }}
                      error={entry.pr_links}
                      type="url"
                      placeholder="https://github.com/…/pull/…"
                    />
                    <div className="sm:col-span-2">
                      <TextAreaField
                        id={`join-oss-desc-${index}`}
                        label="Summary"
                        rows={3}
                        value={oss.description}
                        onChange={(event) => {
                          const value = event.target.value;
                          setEntries(
                            "oss",
                            (list) =>
                              list.map((item, i) =>
                                i === index
                                  ? { ...item, description: value }
                                  : item,
                              ),
                            `oss.${index}.description`,
                          );
                        }}
                        error={entry.description}
                        placeholder="Triaged beginner issues, reviewed 40+ PRs, shipped the v3 migration codemod."
                      />
                    </div>
                  </div>
                </div>
              );
            })}
            <div className="mt-4">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={pending}
                onClick={() => addEntry("oss", emptyOss, "oss")}
              >
                <span aria-hidden="true">+</span> Add contribution
              </button>
            </div>

            <div className="mt-7">
              <h3 className="text-[17px] font-semibold text-ink">Links</h3>
              <p className="mt-1 text-[14.5px] text-muted">
                GitHub and LinkedIn matter most to hiring teams.
              </p>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <TextField
                id="join-github"
                label="GitHub"
                value={draft.github}
                onChange={(event) => editField("github", event.target.value)}
                error={errors.github}
                type="url"
                placeholder="https://github.com/you"
              />
              <TextField
                id="join-linkedin"
                label="LinkedIn"
                value={draft.linkedin}
                onChange={(event) => editField("linkedin", event.target.value)}
                error={errors.linkedin}
                type="url"
                placeholder="https://linkedin.com/in/you"
              />
              <TextField
                id="join-portfolio"
                label="Portfolio"
                value={draft.portfolio}
                onChange={(event) => editField("portfolio", event.target.value)}
                error={errors.portfolio}
                type="url"
                placeholder="https://…"
              />
              <TextField
                id="join-resume"
                label="Resume URL"
                value={draft.resume_url}
                onChange={(event) =>
                  editField("resume_url", event.target.value)
                }
                error={errors.resume_url}
                type="url"
                placeholder="https://…"
              />
            </div>
          </>
        );
      case 6:
        return (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                id="join-salary"
                label="Salary expectation"
                hint="Plain number - your period is chosen below."
                value={draft.min_salary}
                onChange={(event) =>
                  editField("min_salary", event.target.value)
                }
                error={errors.min_salary}
                inputMode="numeric"
                placeholder="280000"
              />
              <SelectField
                id="join-currency"
                label="Currency"
                value={draft.currency}
                options={CURRENCY_OPTIONS}
                onChange={(event) => editField("currency", event.target.value)}
                error={errors.currency}
              />
              <SelectField
                id="join-frequency"
                label="Salary frequency"
                value={draft.frequency}
                options={FREQUENCY_OPTIONS}
                onChange={(event) => editField("frequency", event.target.value)}
                error={errors.frequency}
              />
              <SelectField
                id="join-notice"
                label="Notice period"
                value={draft.notice_period}
                options={withValue(NOTICE_OPTIONS, draft.notice_period)}
                onChange={(event) =>
                  editField("notice_period", event.target.value)
                }
                error={errors.notice_period}
              />
              <SelectField
                id="join-availability"
                label="Availability"
                value={draft.availability}
                options={withValue(AVAILABILITY_OPTIONS, draft.availability)}
                onChange={(event) =>
                  editField("availability", event.target.value)
                }
                error={errors.availability}
              />
              <SelectField
                id="join-work-mode"
                label="Preferred work mode"
                value={draft.remote_pref}
                options={WORK_MODE_OPTIONS}
                onChange={(event) => editField("remote_pref", event.target.value)}
                error={errors.remote_pref}
              />
            </div>
            <div className="mt-4">
              <SelectField
                id="join-visibility"
                label="Visibility"
                hint="Unlisted keeps you out of search but your page still works from a direct link."
                value={draft.visibility}
                options={VISIBILITY_OPTIONS}
                onChange={(event) =>
                  editField("visibility", event.target.value)
                }
                error={errors.visibility}
              />
            </div>
            <div className="mt-4">
              <CheckField
                id="join-consent"
                label="I consent to Tammy processing this profile for matching"
                checked={draft.consent}
                onChange={(checked) =>
                  edit((next) => {
                    next.consent = checked;
                  }, "consent")
                }
                error={errors.consent}
              />
              <p className="field-hint">
                You can turn this off later from your dashboard.
              </p>
            </div>
          </>
        );
      case 7:
        return (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                id="join-account-email"
                label="Account email"
                hint="Sign-in and replies both land here."
                value={draft.email}
                onChange={(event) => editField("email", event.target.value)}
                error={errors.email}
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
              />
              <div />
              <TextField
                id="join-password"
                label="Password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  touch("password");
                }}
                error={errors.password}
                type="password"
                placeholder="At least 8 characters"
                autoComplete="new-password"
              />
              <TextField
                id="join-confirm"
                label="Confirm password"
                value={confirm}
                onChange={(event) => {
                  setConfirm(event.target.value);
                  touch("confirm");
                }}
                error={errors.confirm}
                type="password"
                placeholder="Repeat your password"
                autoComplete="new-password"
              />
            </div>
            <div className="notice mt-4">
              <strong>Before you publish</strong>
              <ul className="mt-1.5 list-disc pl-5">
                <li>
                  Your page starts unlisted - only people with the link can see
                  it.
                </li>
                <li>
                  Hiring teams see your contact details when they open your
                  page.
                </li>
                <li>You can edit or unpublish any time from your dashboard.</li>
              </ul>
            </div>
          </>
        );
      default:
        return null;
    }
  }
}
