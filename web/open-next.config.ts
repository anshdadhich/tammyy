import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// R2 is not provisioned on this account yet (dashboard enable required).
// The dummy incremental cache keeps deploy working; switch to the R2 cache
// override once tammy-media exists and add the NEXT_INC_CACHE_R2_BUCKET
// binding alongside it.
export default defineCloudflareConfig({
  incrementalCache: "dummy",
});
