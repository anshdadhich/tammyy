/**
 * One pipeline instance per candidate per hour: reruns within the window
 * dedupe to the same instance instead of piling up, while an edited profile
 * an hour later gets a fresh run.
 */
export async function enqueueProfilePipeline(
  env: CloudflareEnv,
  candidateId: string,
): Promise<void> {
  const hour = Math.floor(Date.now() / 3_600_000);
  const pipeline = env.PROFILE_PIPELINE as unknown as {
    create(options: { id: string; params: { candidateId: string } }): Promise<unknown>;
  };
  try {
    await pipeline.create({
      id: `${candidateId}-${hour}`,
      params: { candidateId },
    });
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    if (!/already exists/i.test(msg)) throw e;
  }
}
