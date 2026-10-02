import { drizzle } from "drizzle-orm/d1";
import { cfEnv } from "@/lib/cf";
import * as schema from "./schema";

export type Db = ReturnType<typeof drizzle<typeof schema>>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function getDb(): Promise<Db> {
  const env = await cfEnv();
  return drizzle(env.DB, { schema });
}

export { schema };
