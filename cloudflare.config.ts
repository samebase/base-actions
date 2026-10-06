// The Worker of this app: static assets, no Worker code. scripts/build-worker.ts
// evaluates this file through the Wrangler bundler and writes Build Output to
// .cloudflare/output/v0/. `cf deploy --prebuilt` and
// `cf previews deploy --prebuilt` upload that output without evaluating the
// file again. wrangler.config.ts holds the build settings of the bundler.
//
// The setup stack (alchemy.run.ts) imports `worker` for its name, so the
// Worker shell it creates and the Worker that cf deploys are the same Worker.
// Keep `worker` a plain object so that import needs no config context.
import { defineConfig, defineWorker } from "cf/config";

import { deployNames } from "./scripts/deploy-names.ts";

export const worker = defineWorker({
  name: deployNames().worker,
  compatibilityDate: "2026-05-14",
  previewUrls: true,
  assets: {
    htmlHandling: "none",
    // Cloudflare SPA mode serves /index.html for unknown app routes. Keep
    // vite.config.ts emitting the TanStack Start shell there.
    notFoundHandling: "single-page-application",
  },
});

export default defineConfig({ worker });
