import { loadEnv } from "./lib/env.mjs";

const env = loadEnv(new URL("../.env.local", import.meta.url));
const BASE = process.env.BASE_URL || "http://localhost:3000";
const HR_EMAIL = process.env.E2E_HR_EMAIL || env.E2E_HR_EMAIL || "employer@test.com";
const HR_PASSWORD = process.env.E2E_HR_PASSWORD || env.E2E_HR_PASSWORD || "Test@1234";
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { if (cond) { pass++; } else { fail++; } console.log(`${cond ? "PASS" : "FAIL"} ${name} ${extra}`); };

// Network errors answer as status 0 so checks fail cleanly instead of crashing.
async function safeFetch(path, init) {
  try {
    return await fetch(`${BASE}${path}`, init);
  } catch {
    return {
      ok: false,
      status: 0,
      headers: new Headers(),
      json: async () => ({}),
    };
  }
}

// set-cookie may arrive as `tammy_session=<token>; Path=/; HttpOnly; SameSite=Lax`.
function cookieFrom(res) {
  const raw =
    typeof res.headers?.getSetCookie === "function"
      ? res.headers.getSetCookie().join("\n")
      : res.headers?.get?.("set-cookie") ?? "";
  const m = raw.match(/tammy_session=([^;\s]+)/);
  return m ? `tammy_session=${m[1]}` : "";
}

let employerStatus = "";

async function hrSignIn() {
  // Hire-side account: 200/201 = fresh account, 409 {code:"exists"} = already
  // signed up (run reset-test-data first) -> sign in instead.
  const signup = await safeFetch("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: HR_EMAIL, password: HR_PASSWORD }),
  });
  const signupBody = await signup.json().catch(() => null);
  const exists = signup.status === 409 && signupBody?.code === "exists";
  const signupOk =
    (signup.status === 200 || signup.status === 201) && signupBody?.ok === true;
  ok(
    "hr signup via app auth",
    signupOk || exists,
    `(${signup.status}${exists ? " exists" : ""}${!exists && signupBody?.error ? " " + signupBody.error : ""})`,
  );

  const login = await safeFetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: HR_EMAIL, password: HR_PASSWORD }),
  });
  const body = await login.json().catch(() => null);
  const loginOk = login.status === 200 && body?.ok === true && body?.kind === "hr";
  ok(
    "hr password sign-in (run reset-test-data first)",
    loginOk,
    `(${login.status} kind=${body?.kind ?? "-"}${body?.error ? " " + body.error : ""})`,
  );
  if (!loginOk) return "";

  const cookie = cookieFrom(login);
  employerStatus = body.employerStatus ?? "";

  const me = await (await safeFetch("/api/auth/me", { headers: { cookie } })).json().catch(() => null);
  ok(
    "hr session via app auth",
    me?.authenticated === true && me?.viewer?.email === HR_EMAIL.toLowerCase(),
    `(${me?.viewer?.email ?? "no-session"})`,
  );
  return cookie;
}

const HR_COOKIE = await hrSignIn();

function authedFetch(path, init = {}) {
  return safeFetch(path, {
    ...init,
    headers: {
      ...(init.headers || {}),
      ...(HR_COOKIE ? { cookie: HR_COOKIE } : {}),
    },
  });
}

const job = {
  title: "Backend Developer (Node/Postgres)", domain: "Software Development", seniority: "mid",
  must_have: ["Node.js", "PostgreSQL"], nice_to_have: ["Redis"],
  min_exp: 1, max_exp: 4, salary_min: 40000, salary_max: 80000,
  currency: "INR", location: "Remote", remote_policy: "remote", employment_type: "full-time",
  description: "Build logistics APIs with Node.js and PostgreSQL. Realtime tracking with WebSockets and Redis a plus. Must own auth, schema design, deployment.",
};

// The employer-session checks need a VERIFIED employer row (requireHrDb) plus
// the seeded "Test Candidate" - both come from scripts/reset-test-data.mjs.
// Without that seed there is no app endpoint that can self-provision a
// verified employer (verification is admin-gated), so degrade to skips.
const fullRun = employerStatus === "verified";
let res, json;
if (fullRun) {
  res = await authedFetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job, limit: 20 }) });
  json = await res.json().catch(() => ({}));
  ok("fast search 200 + seeded candidate", res.ok && JSON.stringify(json).includes("Test Candidate"), `(${(json.results ?? []).length} rows)`);
  const cand = (json.results ?? []).find((r) => (r.full_name ?? "") === "Test Candidate");
  const cid = cand?.id ?? cand?.candidate_id;

  if (cid) {
    res = await authedFetch("/api/shortlists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidate_id: cid, notes: "e2e" }) });
    json = await res.json().catch(() => ({}));
    ok("shortlist save", res.status === 201 || res.status === 200, `(${res.status})`);
    res = await authedFetch(`/api/shortlists?candidate_id=${cid}`);
    json = await res.json().catch(() => ({}));
    ok("shortlist list", res.ok && (json.results ?? []).length > 0);
    res = await authedFetch("/api/contacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidate_id: cid, channel: "email", message: "e2e hello" }) });
    ok("contact log", res.status === 201 || res.status === 200, `(${res.status})`);
    res = await authedFetch(`/api/candidates?id=${cid}`);
    json = await res.json().catch(() => ({}));
    ok("candidate GET + summary", res.ok && !!json.candidate, `(matches:${(json.matches ?? []).length} views:${(json.contact_log ?? []).length})`);
  } else {
    ok("seeded candidate found", false, "(search fallback empty?)");
    fail += 2;
    console.log("FAIL shortlist/contact skipped (no cid)");
  }
  res = await authedFetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job, limit: 5, deep: true }) });
  json = await res.json().catch(() => ({}));
  ok("deep search responds", res.ok, `(deep:${!!(json.results ?? [])[0]?.judge}${json.deepError ? " judge-skipped-no-key" : ""})`);
} else {
  console.log(
    HR_COOKIE
      ? `SKIP employer-session checks (fast search, shortlist, contact log, candidate GET, deep search - employer status "${employerStatus || "none"}", run reset-test-data.mjs first)`
      : "SKIP employer-session checks (fast search, shortlist, contact log, candidate GET, deep search - no hr session)",
  );
}

const logout = await authedFetch("/api/auth/logout", { method: "POST" });
const logoutBody = await logout.json().catch(() => ({}));
ok("logout", logout.ok && logoutBody?.ok === true, `(${logout.status})`);

console.log(`--- ${pass} passed, ${fail} failed ---`);
process.exit(fail ? 1 : 0);
