import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function cfEnv(): Promise<CloudflareEnv> {
  const { env } = await getCloudflareContext({ async: true });
  return env;
}
