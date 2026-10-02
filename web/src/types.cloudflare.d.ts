// CloudflareEnv is generated as `interface Env` inside the Cloudflare
// namespace by `wrangler types`; alias it to the name the app code uses.
// MEDIA is optional until R2 is enabled on the account and the binding in
// wrangler.jsonc is restored.
interface CloudflareEnv extends Env {
  MEDIA?: R2Bucket;
}
