"use client";

import { useState } from "react";
import type { AdminEmployer } from "@/lib/admin-employers";

type Status = "pending" | "verified" | "rejected" | "all";
type Action = "verify" | "reject" | "set_plan";

const TABS: { label: string; value: Status }[] = [
  { label: "Pending", value: "pending" },
  { label: "Verified", value: "verified" },
  { label: "Rejected", value: "rejected" },
  { label: "All", value: "all" },
];

const PLANS = [
  { value: "free", label: "free · 25/mo" },
  { value: "basic", label: "basic · 500/mo" },
  { value: "pro", label: "pro · 2000/mo" },
];

function domainMatches(email: string | null, website: string | null): boolean {
  if (!email || !website) return false;
  const at = email.indexOf("@");
  if (at < 0) return false;
  const emailDomain = email.slice(at + 1).toLowerCase();
  let host = "";
  try {
    host = new URL(website.includes("://") ? website : `https://${website}`).hostname;
  } catch {
    host = "";
  }
  host = host.toLowerCase().replace(/^www\./, "");
  if (!host) return false;
  return emailDomain === host || emailDomain.endsWith(`.${host}`);
}

export default function AdminEmployers({
  initialEmployers,
}: {
  initialEmployers: AdminEmployer[];
}) {
  const [status, setStatus] = useState<Status>("pending");
  const [rows, setRows] = useState<AdminEmployer[]>(initialEmployers);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [plans, setPlans] = useState<Record<string, string>>(
    () => Object.fromEntries(initialEmployers.map((r) => [r.id, r.plan ?? "free"])),
  );

  async function load(next: Status): Promise<void> {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/employers?status=${next}`, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as { error?: string; employers?: AdminEmployer[] };
      if (!res.ok) {
        setError(json.error || "Something went wrong");
        return;
      }
      setRows(Array.isArray(json.employers) ? json.employers : []);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  function selectTab(next: Status) {
    setStatus(next);
    void load(next);
  }

  async function act(employerId: string, action: Action, plan?: string): Promise<void> {
    if (busy) return;
    setBusy(employerId);
    setError("");
    try {
      const res = await fetch("/api/admin/employers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(plan ? { employerId, action, plan } : { employerId, action }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error || "Something went wrong");
        return;
      }
      if (action === "set_plan" && plan) {
        setPlans((prev) => ({ ...prev, [employerId]: plan }));
      }
      await load(status);
    } catch {
      setError("Network error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div aria-busy={loading}>
      <div className="flex flex-wrap items-center gap-2 mb-6" role="tablist" aria-label="Verification status filter">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={status === tab.value}
            className={status === tab.value ? "btn btn-sm press btn-primary" : "btn btn-sm press btn-secondary"}
            onClick={() => selectTab(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div aria-live="polite">
        {error && <p className="field-error mb-3">{error}</p>}
      </div>
      <ul className="grid gap-3">
        {rows.map((row) => {
          const isPending = row.verification_status === "pending";
          const match = domainMatches(row.company_email, row.website);
          const meta = [row.company_email, row.industry, row.company_size].filter(
            (v): v is string => typeof v === "string" && v.length > 0,
          );
          const created = row.created_at ? row.created_at.slice(0, 10) : "";
          const locked = busy !== null;
          return (
            <li key={row.id} className="rounded-2xl bg-surface border border-line p-5 flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="font-semibold text-ink">
                  {row.company_name ?? "Employer"}{" "}
                  <span className="meta-chip" title={match ? "Work email domain matches the company website" : "Work email domain does not match the company website"}>
                    {match ? "domain match" : "no domain match"}
                  </span>
                </p>
                <p className="text-[13px] text-muted mt-1">{meta.join(" · ")}</p>
                <p className="text-[13px] mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {row.website && (
                    <a href={row.website} target="_blank" rel="noopener noreferrer" className="underline decoration-muted underline-offset-2">
                      Website
                    </a>
                  )}
                  {row.linkedin_url ? (
                    <a href={row.linkedin_url} target="_blank" rel="noopener noreferrer" className="underline decoration-muted underline-offset-2">
                      LinkedIn
                    </a>
                  ) : (
                    <span className="text-muted">No LinkedIn provided</span>
                  )}
                </p>
                <p className="font-mono text-[11px] text-muted mt-1">
                  {row.verification_status ?? "unknown"}
                  {created && ` · since ${created}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {isPending ? (
                  <>
                    <button type="button" className="btn btn-primary btn-sm press" disabled={locked} onClick={() => void act(row.id, "verify")}>
                      Verify
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm press" disabled={locked} onClick={() => void act(row.id, "reject")}>
                      Reject
                    </button>
                  </>
                ) : (
                  <>
                    <label className="font-mono text-[11px] text-muted" htmlFor={`plan-${row.id}`}>
                      Plan
                    </label>
                    <select
                      id={`plan-${row.id}`}
                      className="input"
                      style={{ maxWidth: 130 }}
                      aria-label={`Billing plan for ${row.company_name ?? "employer"}`}
                      value={plans[row.id] ?? row.plan ?? "free"}
                      disabled={locked}
                      onChange={(e) => void act(row.id, "set_plan", e.target.value)}
                    >
                      {PLANS.map((plan) => (
                        <option key={plan.value} value={plan.value}>
                          {plan.label}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {rows.length === 0 && !error && (
        <p className="text-[13px] text-muted mt-1">No employers in this view.</p>
      )}
    </div>
  );
}
