import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Explicit binding env for code that runs outside the request path
 * (Workflow steps, Durable Object calls from workflows). The request path
 * resolves through OpenNext's AsyncLocalStorage; everything else sets this
 * once from the entrypoint's own `env` before touching the data layer.
 */
let workflowEnv: CloudflareEnv | null = null;

export function setRuntimeEnv(env: CloudflareEnv): void {
  workflowEnv = env;
}

export async function cfEnv(): Promise<CloudflareEnv> {
  if (workflowEnv) return workflowEnv;
  const { env } = await getCloudflareContext({ async: true });
  return env;
}
