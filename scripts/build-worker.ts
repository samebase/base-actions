// Writes the Build Output of the Worker to .cloudflare/output/v0/, the last
// step of build:app. The deploy steps of .github/workflows/alchemy.yml upload
// the output as it is: `cf deploy --prebuilt` on the default branch,
// `cf previews deploy --prebuilt` on any other branch. The latter accepts only
// a Preview build, so a run with PREVIEW_BRANCH set (scripts/alchemy-stage.ts
// sets it on a branch other than the default branch) writes one. Other builds
// write a production build.
//
// `cf build` cannot write this output: it runs the build command of the
// framework it detects (`vite build` for TanStack Start), and this project
// builds with Vite+ and bundles the Worker with Wrangler. For a project on
// the Wrangler bundler, `cf build` itself runs the Wrangler delegate below,
// and only the delegate takes `--preview`.
import { execFileSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const wranglerDelegate = fileURLToPath(
  new URL("./bin/cf-wrangler.js", import.meta.resolve("wrangler/package.json")),
);
const preview = (process.env["PREVIEW_BRANCH"] ?? "") !== "";

execFileSync(process.execPath, [wranglerDelegate, "build", ...(preview ? ["--preview"] : [])], {
  stdio: "inherit",
});
