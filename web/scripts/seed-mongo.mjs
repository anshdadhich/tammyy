#!/usr/bin/env node
/**
 * seed-mongo.mjs — local dev data for MongoDB (replaces seed_skills.sql +
 * seed_demo.sql).
 *
 * Creates (idempotent — safe to re-run):
 *   1. ~46 canonical skills (upsert by name)
 *   2. 1 verified demo employer + 2 demo jobs (fixed UUIDs)
 *   3. 6 demo candidates (varied domain/exp/salary/remote, @demo.local)
 *   4. candidate_skills links
 *   5. 2 profile_chunks per candidate with fake 1024-dim ZERO vectors so
 *      /hire search returns rows WITHOUT a VOYAGE_API_KEY (distances all
 *      tie at 1.0 → recency order). The real Inngest pipeline overwrites
 *      them with true embeddings.
 *
 * Optional demo HR login (so /hire/login works without signup):
 *   node scripts/seed-mongo.mjs employer@demo.local some-password
 *   → creates/claims the users row, links employers.user_id, keeps the
 *     employer verified.
 *
 * Env: MONGODB_URI (default mongodb://127.0.0.1:27017), MONGODB_DB
 * (default tammy). Reads web/.env.local when present.
 *
 * Demo rows use @demo.local emails — re-running with a different password
 * rotates that login; delete the candidates directly in Mongo to remove.
 */
import { randomUUID, scryptSync, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MongoClient } from "mongodb";

// ---------- env ----------
function loadEnvFile() {
  const p = path.join(process.cwd(), ".env.local");
  try {
    const raw = fs.readFileSync(p, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!(m[1] in process.env)) process.env[m[1]] = v;
    }
  } catch {
    // no .env.local — defaults are fine
  }
}
loadEnvFile();

const URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const DB = process.env.MONGODB_DB || "tammy";

// Same format as src/lib/password.ts: scrypt$N$r$p$salt$hash
function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password.normalize("NFKC"), salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$16384$8$1$${salt.toString("base64")}$${hash.toString("base64")}`;
}

const DEMO_EMPLOYER_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

// ---------- data (canonical skills, formerly supabase/seed_skills.sql) ----------
const SKILLS = [
  ["JavaScript", ["JS", "Javascript", "ECMAScript", "ES6", "ES2015+"], "frontend"],
  ["TypeScript", ["TS", "Typescript", "TSX"], "frontend"],
  ["React", ["ReactJS", "React.js", "Reactjs"], "frontend"],
  ["Next.js", ["NextJS", "Next", "Nextjs"], "frontend"],
  ["Vue.js", ["VueJS", "Vue", "Vuejs", "Nuxt", "Nuxt.js"], "frontend"],
  ["Angular", ["AngularJS", "Angularjs", "Angular 2+"], "frontend"],
  ["HTML", ["HTML5", "html", "Semantic HTML"], "frontend"],
  ["CSS", ["CSS3", "css", "Flexbox", "Grid"], "frontend"],
  ["Tailwind CSS", ["Tailwind", "tailwindcss", "TailwindCSS"], "frontend"],
  ["Redux", ["React Redux", "Redux Toolkit", "RTK"], "frontend"],
  ["Node.js", ["NodeJS", "Node", "nodejs", "Nodejs"], "backend"],
  ["Express.js", ["Express", "ExpressJS", "Expressjs"], "backend"],
  ["Python", ["py", "Python3", "python3"], "backend"],
  ["Django", ["django", "Django REST", "DRF"], "backend"],
  ["Flask", ["flask"], "backend"],
  ["FastAPI", ["fast-api", "fastapi", "Fast Api"], "backend"],
  ["Java", ["java", "Core Java", "Java 8+"], "backend"],
  ["Spring Boot", ["Spring", "SpringBoot", "Spring Framework"], "backend"],
  ["Go", ["Golang", "GoLang", "golang"], "backend"],
  ["Rust", ["rust"], "backend"],
  ["GraphQL", ["graphql", "Graphql", "Apollo", "Hasura"], "backend"],
  ["REST APIs", ["REST", "Rest API", "RESTful", "RESTful APIs", "Restful"], "backend"],
  ["PostgreSQL", ["Postgres", "postgres", "pgsql", "psql", "Postgresql"], "backend"],
  ["MySQL", ["mysql", "Mysql", "MariaDB", "mariadb"], "backend"],
  ["MongoDB", ["mongo", "Mongo", "mongodb", "Mongoose", "mongoose"], "backend"],
  ["Redis", ["redis", "Upstash", "upstash"], "backend"],
  ["Supabase", ["supabase"], "backend"],
  ["Firebase", ["firebase", "Firestore", "firestore"], "backend"],
  ["Prisma", ["prisma", "Prisma ORM"], "backend"],
  ["Docker", ["docker", "Docker Compose", "docker-compose", "Containerization"], "devops_cloud"],
  ["Kubernetes", ["K8s", "k8s", "K8S", "Kube"], "devops_cloud"],
  ["AWS", ["Amazon Web Services", "aws", "EC2", "S3", "Lambda"], "devops_cloud"],
  ["CI/CD", ["CICD", "Continuous Integration", "Continuous Deployment", "GitHub Actions", "Github Actions", "GitLab CI"], "devops_cloud"],
  ["Git", ["git", "Version Control", "Github", "GitHub", "GitLab", "gitlab"], "tools"],
  ["Linux", ["linux", "Unix", "unix", "Bash", "bash", "Shell"], "tools"],
  ["Figma", ["figma", "FigJam", "UI Design"], "tools"],
  ["React Native", ["react-native", "React-Native", "react native", "Expo", "expo"], "mobile"],
  ["Flutter", ["flutter", "Dart", "dart"], "mobile"],
  ["Swift", ["swift", "iOS", "ios", "SwiftUI", "UIKit", "Xcode"], "mobile"],
  ["Kotlin", ["kotlin", "Android", "android", "Jetpack Compose"], "mobile"],
  ["Pandas", ["pandas", "Data Analysis"], "data_ai"],
  ["NumPy", ["numpy", "Numpy", "Numerical Computing"], "data_ai"],
  ["PyTorch", ["pytorch", "Pytorch", "Torch"], "data_ai"],
  ["TensorFlow", ["tensorflow", "Tensorflow", "Keras", "keras"], "data_ai"],
  ["scikit-learn", ["sklearn", "Sklearn", "SciKit-Learn", "Machine Learning"], "data_ai"],
  ["OpenAI API", ["OpenAI", "openai", "LLM", "LLMs", "LangChain", "langchain", "RAG", "Prompt Engineering"], "data_ai"],
];

// ---------- data (demo rows, formerly supabase/seed_demo.sql) ----------
const JOBS = [
  {
    _id: "cccccccc-cccc-cccc-cccc-ccccccccccc1",
    title: "Backend Developer (Node/Postgres)",
    domain: "Software Development",
    seniority: "mid",
    description:
      "Build logistics APIs with Node.js and PostgreSQL. Own auth, schema design, Redis caching, and deployment. Realtime tracking with WebSockets is a plus.",
    responsibilities: "Design Postgres schemas; build REST APIs; add Redis caching; ship to production",
    must_have_skills: ["Node.js", "PostgreSQL"],
    nice_to_have_skills: ["Redis", "Docker"],
    min_experience: 1,
    max_experience: 4,
    salary_min: 40000,
    salary_max: 80000,
    salary_currency: "INR",
    location: "Remote",
    remote_policy: "remote",
    employment_type: "full-time",
    status: "active",
  },
  {
    _id: "cccccccc-cccc-cccc-cccc-ccccccccccc2",
    title: "Frontend Developer (React)",
    domain: "Software Development",
    seniority: "mid",
    description:
      "Build operator dashboards in React + TypeScript + Tailwind. Consume REST APIs, own loading/error states, and keep Lighthouse green.",
    responsibilities: "Build dashboard pages; integrate REST APIs; maintain design system usage",
    must_have_skills: ["React", "TypeScript"],
    nice_to_have_skills: ["Tailwind CSS", "REST APIs"],
    min_experience: 2,
    max_experience: 5,
    salary_min: 50000,
    salary_max: 90000,
    salary_currency: "INR",
    location: "Pune",
    remote_policy: "hybrid",
    employment_type: "full-time",
    status: "active",
  },
];

function demoCandidate(n, extra) {
  const base = {
    _id: `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa${n}`,
    user_id: null,
    headline: extra.headline,
    domain: extra.domain,
    current_position: extra.current_position,
    total_experience_years: extra.exp,
    education_level: null,
    location_city: extra.city,
    location_country: "India",
    remote_preference: extra.remote,
    open_to_relocation: extra.reloc,
    min_salary: extra.salary,
    salary_currency: "INR",
    salary_frequency: "monthly",
    salary_negotiable: extra.negotiable,
    notice_period: null,
    availability_status: extra.avail,
    photo_url: null,
    contact_email: `${extra.handle}@demo.local`,
    contact_phone: `+91 98765 0000${n}`,
    linkedin_url: `https://linkedin.com/in/demo-${extra.handle}`,
    github_url: `https://github.com/demo-${extra.handle}`,
    portfolio_url: null,
    resume_url: null,
    visibility_status: "visible",
    consent_status: "granted",
    profile_strength: extra.strength,
    show_email: true,
    show_phone: true,
    show_linkedin: true,
    show_github: true,
    show_portfolio: true,
    show_resume: true,
    show_photo: true,
  };
  return { ...base, full_name: extra.name };
}

const CANDIDATES = [
  demoCandidate(1, {
    name: "Asha Sharma", handle: "asha.backend",
    headline: "Node/Postgres APIs, auth + caching, 2y", domain: "backend",
    current_position: "SDE-1 @ Acme", exp: 2, city: "Pune", remote: "remote_only",
    reloc: false, salary: 45000, negotiable: true, avail: "immediate", strength: 82,
  }),
  demoCandidate(2, {
    name: "Rohan Mehta", handle: "rohan.frontend",
    headline: "React dashboards, design systems, 4y", domain: "frontend",
    current_position: "Frontend Dev @ BrightUI", exp: 4, city: "Bengaluru", remote: "hybrid",
    reloc: true, salary: 80000, negotiable: true, avail: "notice", strength: 78,
  }),
  demoCandidate(3, {
    name: "Priya Nair", handle: "priya.data",
    headline: "ML pipelines, churn + forecasting, 5y", domain: "data",
    current_position: "Data Scientist @ Insightful", exp: 5, city: "Remote", remote: "remote_only",
    reloc: false, salary: 120000, negotiable: true, avail: "immediate", strength: 85,
  }),
  demoCandidate(4, {
    name: "Karan Patel", handle: "karan.mobile",
    headline: "Flutter apps, 100k installs, 1y", domain: "mobile",
    current_position: "Junior Mobile Dev @ AppWorks", exp: 1, city: "Ahmedabad", remote: "onsite",
    reloc: false, salary: 35000, negotiable: true, avail: "immediate", strength: 64,
  }),
  demoCandidate(5, {
    name: "Sneha Kulkarni", handle: "sneha.devops",
    headline: "K8s + AWS cost cuts, platform, 7y", domain: "devops",
    current_position: "Senior DevOps @ CloudNine", exp: 7, city: "Hyderabad", remote: "flexible",
    reloc: true, salary: 150000, negotiable: false, avail: "notice", strength: 90,
  }),
  demoCandidate(6, {
    name: "Vikram Singh", handle: "vikram.fullstack",
    headline: "Next.js + Supabase SaaS, solo-built, 3y", domain: "fullstack",
    current_position: "Full-stack Dev @ IndieHack", exp: 3, city: "Delhi", remote: "hybrid",
    reloc: true, salary: 70000, negotiable: true, avail: "immediate", strength: 76,
  }),
];

const SKILL_LINKS = [
  [1, ["Node.js", "PostgreSQL", "Redis"], 2, "advanced", 70],
  [2, ["React", "TypeScript", "Tailwind CSS"], 4, "advanced", 75],
  [3, ["Python", "Pandas", "scikit-learn"], 5, "expert", 80],
  [4, ["Flutter", "Kotlin"], 1, "intermediate", 55],
  [5, ["Docker", "Kubernetes", "AWS"], 7, "expert", 85],
  [6, ["Next.js", "Supabase", "PostgreSQL"], 3, "advanced", 70],
];

const CHUNKS = [
  [1, "summary", "Backend developer, 2y. Node.js PostgreSQL Redis. Built delivery APIs, cut p95 800ms to 250ms via Redis caching. Open to remote.", { domain: "backend" }],
  [1, "project", "Project: Delivery tracker. Realtime tracking with Socket.io and Redis. Sole backend. 500 concurrent connections.", { technologies: ["Node.js", "PostgreSQL", "Redis"] }],
  [2, "summary", "Frontend developer, 4y. React TypeScript Tailwind. Built operator dashboards used by 3 logistics teams. Design system contributor.", { domain: "frontend" }],
  [2, "project", "Project: Fleet dashboard. React + TypeScript dashboard with 40+ views, virtualized tables, offline-safe mutations.", { technologies: ["React", "TypeScript"] }],
  [3, "summary", "Data scientist, 5y. Python scikit-learn Pandas. Churn model lifted retention 6%. Forecasting pipelines on 10M rows.", { domain: "data" }],
  [3, "project", "Project: Churn predictor. Gradient boosting on usage features, SHAP explanations, weekly retrain pipeline.", { technologies: ["Python", "scikit-learn", "Pandas"] }],
  [4, "summary", "Mobile developer, 1y. Flutter Dart. Shipped expense app with 100k installs, 4.6 rating. Firebase backend.", { domain: "mobile" }],
  [4, "project", "Project: Expense app. Flutter offline-first with local sync, Firebase auth, crash-free 99.5%.", { technologies: ["Flutter"] }],
  [5, "summary", "DevOps engineer, 7y. AWS Kubernetes Terraform. Cut infra spend 35%, led migration of 20 services to EKS with zero downtime.", { domain: "devops" }],
  [5, "project", "Project: EKS migration. Terraform modules, GitHub Actions pipelines, autoscaling policies for 20 services.", { technologies: ["AWS", "Kubernetes", "Docker"] }],
  [6, "summary", "Full-stack developer, 3y. Next.js Supabase PostgreSQL. Solo-built invoicing SaaS with 200 paying users.", { domain: "fullstack" }],
  [6, "project", "Project: Invoice SaaS. Next.js + Supabase with RLS, Stripe billing, PDF generation. 200 paying users.", { technologies: ["Next.js", "Supabase", "PostgreSQL"] }],
];

const DEMO_IDS = CANDIDATES.map((c) => c._id);

async function main() {
  const [loginEmail, loginPassword] = process.argv.slice(2);
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db(DB);
  console.log(`seeding ${DB} @ ${URI}`);

  // 1. skills (upsert by name — mirrors ON CONFLICT (name))
  const skills = db.collection("skills");
  let skillCount = 0;
  for (const [name, aliases, category] of SKILLS) {
    await skills.updateOne(
      { name },
      { $set: { aliases, category }, $setOnInsert: { _id: randomUUID(), name, created_at: new Date() } },
      { upsert: true },
    );
    skillCount++;
  }
  console.log(`skills: ${skillCount}`);

  // 2. demo employer (fixed _id — upsert mirrors ON CONFLICT (id))
  const employers = db.collection("employers");
  await employers.updateOne(
    { _id: DEMO_EMPLOYER_ID },
    {
      $set: {
        company_name: "Demo Logistics Co",
        company_email: "hiring@demo.local",
        website: "https://demo.local",
        company_size: "11-50",
        industry: "Logistics",
        verification_status: "verified",
        updated_at: new Date(),
      },
      $setOnInsert: {
        _id: DEMO_EMPLOYER_ID,
        user_id: null,
        created_at: new Date(),
      },
    },
    { upsert: true },
  );
  console.log("employer: Demo Logistics Co (verified)");

  // 3. demo jobs
  const jobs = db.collection("jobs");
  for (const job of JOBS) {
    const { _id, ...fields } = job;
    await jobs.updateOne(
      { _id },
      {
        $set: { ...fields, employer_id: DEMO_EMPLOYER_ID, updated_at: new Date() },
        $setOnInsert: { created_at: new Date() },
      },
      { upsert: true },
    );
  }
  console.log(`jobs: ${JOBS.length}`);

  // 4. demo candidates (fixed ids)
  const candidates = db.collection("candidates");
  for (const c of CANDIDATES) {
    const { _id, ...fields } = c;
    const now = new Date();
    await candidates.updateOne(
      { _id },
      {
        $set: { ...fields, updated_at: now },
        $setOnInsert: { created_at: now, freshness_updated_at: now },
      },
      { upsert: true },
    );
  }
  console.log(`candidates: ${CANDIDATES.length}`);

  // 5. candidate_skills links (resolve names → ids first)
  const skillRows = await skills.find({}, { projection: { _id: 1, name: 1 } }).toArray();
  const skillIdByName = new Map(skillRows.map((s) => [s.name, s._id]));
  const links = db.collection("candidate_skills");
  let linkCount = 0;
  for (const [n, names, exp, proficiency, evidence] of SKILL_LINKS) {
    const candidate_id = `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa${n}`;
    for (const name of names) {
      const skill_id = skillIdByName.get(name);
      if (!skill_id) {
        console.warn(`  ! skill not found, skipped: ${name}`);
        continue;
      }
      const res = await links.updateOne(
        { candidate_id, skill_id },
        {
          $setOnInsert: {
            _id: randomUUID(),
            candidate_id,
            skill_id,
            experience_years: exp,
            proficiency_level: proficiency,
            source: "extracted",
            evidence_strength: evidence,
          },
        },
        { upsert: true },
      );
      linkCount += res.upsertedCount ? 1 : 0;
    }
  }
  console.log(`candidate_skills: ${linkCount} inserted`);

  // 6. profile_chunks with zero vectors (delete + reinsert, like the SQL)
  const chunks = db.collection("profile_chunks");
  await chunks.deleteMany({ candidate_id: { $in: DEMO_IDS } });
  const zero = Array(1024).fill(0);
  const now = new Date();
  await chunks.insertMany(
    CHUNKS.map(([n, chunk_type, content_text, metadata_json]) => ({
      _id: randomUUID(),
      candidate_id: `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa${n}`,
      chunk_type,
      content_text,
      metadata_json,
      embedding: zero,
      embedding_model: "voyage-4-lite",
      embedding_dim: 1024,
      created_at: now,
    })),
  );
  console.log(`profile_chunks: ${CHUNKS.length} (zero vectors — run the real pipeline to embed)`);

  // 7. optional demo HR login → links the users row to the verified employer
  if (loginEmail || loginPassword) {
    if (!loginEmail || !loginPassword) {
      console.warn("  ! provide BOTH email and password for the demo HR login (or neither)");
    } else {
      const users = db.collection("users");
      const email = loginEmail.trim().toLowerCase();
      const existing = await users.findOne({ email });
      if (existing) {
        await users.updateOne(
          { _id: existing._id },
          {
            $set: {
              password_hash: hashPassword(loginPassword),
              role: "employer",
              status: "active",
              email_verified: true,
            },
          },
        );
        await employers.updateOne(
          { _id: DEMO_EMPLOYER_ID },
          { $set: { user_id: String(existing._id) } },
        );
        console.log(`login: ${email} (password rotated, linked to Demo Logistics Co)`);
      } else {
        const _id = randomUUID();
        await users.insertOne({
          _id,
          email,
          password_hash: hashPassword(loginPassword),
          role: "employer",
          status: "active",
          email_verified: true,
          created_at: new Date(),
        });
        await employers.updateOne(
          { _id: DEMO_EMPLOYER_ID },
          { $set: { user_id: _id } },
        );
        console.log(`login: ${email} created + linked to Demo Logistics Co`);
      }
    }
  }

  await client.close();
  console.log("done.");
}

main().catch((e) => {
  console.error("seed failed:", e?.message ?? e);
  process.exit(1);
});
