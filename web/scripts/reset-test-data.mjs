import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { MongoClient } from "mongodb";
import { loadEnv } from "./lib/env.mjs";

const EXPECTED_EMBEDDING_MODEL = "voyage-4-lite";
const MODEL_DIMS = { "voyage-4-lite": 1024 };
const EXPECTED_EMBEDDING_DIM = MODEL_DIMS[EXPECTED_EMBEDDING_MODEL];
if (!EXPECTED_EMBEDDING_DIM) throw new Error("unknown embedding model dim");

const env = loadEnv(new URL("../.env.local", import.meta.url));
const uri = process.env.MONGODB_URI || env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const dbName = process.env.MONGODB_DB || env.MONGODB_DB || "tammy";
let hostname = "";
try {
  hostname = new URL(uri).hostname;
} catch {
  console.error("invalid MongoDB URI");
  process.exit(1);
}
const allowlisted = /localhost|127\.0\.0\.1|test|staging|\.local/i.test(uri);
const confirmed = process.argv.includes("--confirm") || process.argv.includes("--yes");
if (!allowlisted && !confirmed) {
  console.error(`refusing to wipe non-test database host (${hostname}); re-run with --confirm to override`);
  process.exit(1);
}

// Same stored format as src/lib/password.ts: scrypt$16384$8$1$<salt-b64>$<hash-b64>
function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(password.normalize("NFKC"), salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$16384$8$1$${salt.toString("base64")}$${derived.toString("base64")}`;
}

let client;
try {
  client = await new MongoClient(uri).connect();
} catch (err) {
  console.error("mongodb connection failed:", err?.message ?? err);
  process.exit(1);
}
const db = client.db(dbName);

const PASS = "Test@1234";
const ACCOUNTS = [
  { email: "admin@test.com", role: "admin" },
  { email: "employer@test.com", role: "employer" },
  { email: "candidate@test.com", role: "candidate" },
];

try {
  // The old script deleted auth rows for @test.com / @demo.local emails;
  // capture their ids first so their sessions go with them (auth now lives
  // in `users`, which the wipe below removes anyway).
  const testUserIds = (
    await db
      .collection("users")
      .find({ email: /@(test\.com|demo\.local)$/ }, { projection: { _id: 1 } })
      .toArray()
  ).map((u) => u._id);

  for (const t of ["audit_logs","candidate_matches","contact_log","shortlists","searches","job_requirements","jobs","profile_chunks","project_depth_analysis","projects","work_experiences","education","candidate_skills","candidate_profiles","candidates","employers","users"]) {
    try {
      const { deletedCount } = await db.collection(t).deleteMany({});
      console.log("wipe", t, "->", deletedCount, "docs");
    } catch (e) {
      console.log("wipe", t, "->", e.message);
    }
  }
  if (testUserIds.length) {
    try {
      const { deletedCount } = await db
        .collection("sessions")
        .deleteMany({ user_id: { $in: testUserIds } });
      console.log("wipe", "sessions", "->", deletedCount, "docs");
    } catch (e) {
      console.log("wipe", "sessions", "->", e.message);
    }
  }

  const ids = {};
  for (const a of ACCOUNTS) {
    const _id = randomUUID();
    try {
      await db.collection("users").insertOne({
        _id,
        email: a.email,
        password_hash: hashPassword(PASS),
        role: a.role,
        status: "active",
        email_verified: true,
        created_at: new Date(),
      });
    } catch (e) {
      throw new Error("createUser " + a.email + ": " + e.message);
    }
    ids[a.role] = _id;
  }

  const empId = randomUUID();
  await db.collection("employers").insertOne({
    _id: empId,
    company_name: "Test Labs",
    company_email: "employer@test.com",
    verification_status: "verified",
    user_id: ids.employer,
  });
  await db.collection("jobs").insertOne({
    _id: randomUUID(),
    employer_id: empId,
    title: "Backend Developer (Node/Postgres)",
    domain: "Software Development",
    seniority: "mid",
    description:
      "Build logistics APIs with Node.js and PostgreSQL. Realtime tracking with WebSockets and Redis a plus. Must own auth, schema design, deployment.",
    must_have_skills: ["Node.js", "PostgreSQL"],
    nice_to_have_skills: ["Redis"],
    min_experience: 1,
    max_experience: 4,
    salary_min: 40000,
    salary_max: 80000,
    salary_currency: "INR",
    location: "Remote",
    remote_policy: "remote",
    employment_type: "full-time",
    status: "active",
  });

  const candId = randomUUID();
  await db.collection("candidates").insertOne({
    _id: candId,
    full_name: "Test Candidate",
    headline: "Node/Postgres APIs, auth + caching, 2y",
    domain: "Software Development",
    current_position: "SDE-1",
    total_experience_years: 2,
    location_city: "Pune, India",
    remote_preference: "remote_only",
    min_salary: 45000,
    salary_currency: "INR",
    salary_frequency: "monthly",
    availability_status: "immediate",
    visibility_status: "visible",
    consent_status: "granted",
    contact_email: "candidate@test.com",
    contact_phone: "+91 98765 43210",
    user_id: ids.candidate,
  });

  const skillRows = await db
    .collection("skills")
    .find({ name: { $in: ["Node.js", "PostgreSQL", "Redis"] } }, { projection: { _id: 1 } })
    .toArray();
  if (skillRows.length) {
    await db.collection("candidate_skills").insertMany(
      skillRows.map((s) => ({
        _id: randomUUID(),
        candidate_id: candId,
        skill_id: s._id,
        source: "self_reported",
      })),
    );
  }

  const projId = randomUUID();
  await db.collection("projects").insertOne({
    _id: projId,
    candidate_id: candId,
    title: "Delivery tracker",
    description: "Realtime tracking with Socket.io",
    problem_statement: "Live driver updates",
    tech_stack: ["Node.js", "Socket.io", "Redis"],
    role_in_project: "Sole backend",
    impact_summary: "500 concurrent connections",
    project_type: "personal",
  });
  await db.collection("candidate_profiles").insertOne({
    _id: randomUUID(),
    candidate_id: candId,
    summary_markdown:
      "# Test Candidate\n\nBackend developer, 2y, Node/Postgres/Redis. Built delivery tracker with realtime updates (500 concurrent).",
    summary_json: { seeded: true },
  });

  const zeros = new Array(EXPECTED_EMBEDDING_DIM).fill(0);
  if (zeros.length !== 1024) throw new Error("embedding dim drift: expected 1024");
  const zero = "[" + zeros.join(",") + "]";
  await db.collection("profile_chunks").insertMany([
    {
      _id: randomUUID(),
      candidate_id: candId,
      chunk_type: "summary",
      content_text: "Backend developer 2y Node.js PostgreSQL Redis realtime tracking",
      metadata_json: {},
      embedding: zero,
      embedding_model: EXPECTED_EMBEDDING_MODEL,
      embedding_dim: EXPECTED_EMBEDDING_DIM,
    },
    {
      _id: randomUUID(),
      candidate_id: candId,
      chunk_type: "project",
      content_text:
        "Project: Delivery tracker. Realtime tracking with Socket.io. Tech: Node.js, Socket.io, Redis. Impact: 500 concurrent connections.",
      metadata_json: { project_id: projId },
      embedding: zero,
      embedding_model: EXPECTED_EMBEDDING_MODEL,
      embedding_dim: EXPECTED_EMBEDDING_DIM,
    },
  ]);
} catch (e) {
  console.error("reset failed:", e?.message ?? e);
  await client.close().catch(() => {});
  process.exit(1);
}

console.log("RESET DONE. Login with:");
for (const a of ACCOUNTS) console.log(`- ${a.role}: ${a.email} / ${PASS}`);
console.log("Flow (UI removed - use the JSON API): employer -> POST /api/search | candidate -> POST /api/candidates | admin -> POST /api/admin/bootstrap");
await client.close();
