import { scryptAsync } from "@noble/hashes/scrypt.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { cfEnv } from "@/lib/cf";

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 128 * 1024 * 1024;

export function passwordPolicyError(password: unknown): string | null {
  if (typeof password !== "string" || password.length < 8) {
    return "Password must be at least 8 characters.";
  }
  if (password.length > 200) {
    return "Password must be at most 200 characters.";
  }
  return null;
}

function derive(password: string, saltHex: string, n: number, r: number, p: number, keylen: number): Promise<Uint8Array> {
  return scryptAsync(password.normalize("NFKC"), hexToBytes(saltHex), {
    N: n,
    r,
    p,
    dkLen: keylen,
    maxmem: MAXMEM,
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const derived = await derive(password, salt, N, R, P, KEYLEN);
  return `scrypt$${N}$${R}$${P}$${salt}$${bytesToHex(derived)}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  const n = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  // Bound stored params so a crafted hash can't burn unbounded CPU.
  if (n <= 1 || (n & (n - 1)) !== 0 || n > 32768) return false;
  if (r < 1 || r > 16 || p < 1 || p > 8) return false;
  if (!/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(hashHex)) return false;
  if (hashHex.length === 0 || hashHex.length % 2 !== 0) return false;
  try {
    const derived = await derive(password, saltHex, n, r, p, hashHex.length / 2);
    const expected = hexToBytes(hashHex);
    if (derived.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < derived.length; i++) diff |= derived[i] ^ expected[i];
    return diff === 0;
  } catch {
    return false;
  }
}

export type HasherOp = { op: "hash"; password: string } | { op: "verify"; password: string; stored: string };

export type HasherResult = { hash: string } | { valid: boolean };

/**
 * scrypt burns ~100ms of CPU, far past the Worker request budget on the
 * free plan, so auth routes run it inside the PasswordHasher Durable
 * Object, which gets its own 30s CPU budget per invocation.
 */
export async function hashPasswordRemote(password: string): Promise<string> {
  const env = await cfEnv();
  const stub = env.PASSWORD_HASHER.getByName("auth");
  const res = (await stub.fetch("https://do/", {
    method: "POST",
    body: JSON.stringify({ op: "hash", password } satisfies HasherOp),
  }).then((r: Response) => r.json())) as HasherResult;
  if (!("hash" in res)) throw new Error("password hashing failed");
  return res.hash;
}

export async function verifyPasswordRemote(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const env = await cfEnv();
  const stub = env.PASSWORD_HASHER.getByName("auth");
  const res = (await stub.fetch("https://do/", {
    method: "POST",
    body: JSON.stringify({ op: "verify", password, stored } satisfies HasherOp),
  }).then((r: Response) => r.json())) as HasherResult;
  return "valid" in res ? res.valid : false;
}
