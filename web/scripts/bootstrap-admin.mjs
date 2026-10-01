import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { MongoClient } from "mongodb";
import { loadEnv } from "./lib/env.mjs";

const mask = (e) => (!e || !e.includes("@") ? "***" : e.slice(0, 2) + "***@" + e.split("@")[1]);
const env = loadEnv(new URL("../.env.local", import.meta.url));
const bootstrapSecret = env.BOOTSTRAP_SECRET;
if (!bootstrapSecret) {
  console.error("BOOTSTRAP_SECRET is required in web/.env.local - refusing to bootstrap over an open endpoint");
  process.exit(1);
}
const uri = process.env.MONGODB_URI || env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const dbName = process.env.MONGODB_DB || env.MONGODB_DB || "tammy";

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
const users = client.db(dbName).collection("users");
const employers = client.db(dbName).collection("employers");
try {
  await users.createIndex({ email: 1 }, { unique: true });
} catch (err) {
  console.error("could not ensure unique email index:", err?.message ?? err);
  process.exit(1);
}

// Upsert by email: inserts a brand-new admin (fresh _id/created_at) or, on a
// re-run against an existing row, rotates that account's password in place.
async function upsertAdmin(rawEmail) {
  const email = rawEmail.toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error("provide a valid email that has signed up first");
    process.exit(1);
  }
  const password =
    process.argv[3]?.trim() || env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;
  if (!password) {
    console.error(
      "admin password required - pass it after the email argument or set ADMIN_PASSWORD in web/.env.local",
    );
    process.exit(1);
  }
  const password_hash = hashPassword(password);
  const res = await users.updateOne(
    { email },
    {
      $set: { email, password_hash, role: "admin", status: "active", email_verified: true },
      $setOnInsert: { _id: randomUUID(), created_at: new Date() },
    },
    { upsert: true },
  );
  console.log(
    "promoted to admin:",
    mask(email) + (res.upsertedCount ? "" : " (password rotated)"),
  );
  console.log("unset BOOTSTRAP_SECRET now that bootstrap is complete");
}

const target = process.argv[2]?.trim();
if (target) {
  await upsertAdmin(target);
} else {
  const admins = await users
    .find({ role: "admin" }, { projection: { _id: 0, email: 1 } })
    .limit(1)
    .toArray();
  if (admins.length) {
    console.log("admin exists:", mask(admins[0].email), "(bootstrap closed for promotion)");
  } else {
    const first = await users
      .find({}, { projection: { _id: 0, email: 1 } })
      .sort({ created_at: 1 })
      .limit(1)
      .toArray();
    if (!first[0]) {
      console.log("no users yet - sign up at /signup first, then re-run");
      await client.close();
      process.exit(0);
    }
    await upsertAdmin(first[0].email);
  }
}

const pending = await employers.countDocuments({ verification_status: "pending" });
if (pending) {
  await employers.updateMany(
    { verification_status: "pending" },
    { $set: { verification_status: "verified" } },
  );
  console.log("verified employers:", pending);
} else {
  console.log("verified employers: 0 pending");
}
console.log("done");
await client.close();
