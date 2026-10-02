declare module "*/.open-next/worker.js" {
  const handler: {
    fetch(request: Request, env: unknown, ctx: unknown, signal?: AbortSignal): Promise<Response>;
  };
  export default handler;
}
