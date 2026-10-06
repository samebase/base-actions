// The Alchemy stage of a run of .github/workflows/alchemy.yml. The script
// appends STAGE, PREVIEW_BRANCH, and PREVIEW_NAME to GITHUB_ENV for the later
// steps. It imports only Node modules, so it runs before the install.
//
// The default branch deploys the stage `prod`, and PREVIEW_BRANCH and
// PREVIEW_NAME are empty. Every other branch is a preview: the stage is the
// branch made safe by `alchemyStage`, PREVIEW_BRANCH is the branch itself,
// which alchemy.run.ts gives to the Convex preview deployment, and
// PREVIEW_NAME is the Worker Preview name that `cf previews deploy` uploads.
// The destroy of a deleted branch computes the same names.
/// <reference types="node" />
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { deployNames, workerPreviewName } from "./deploy-names.ts";

/**
The stage of a branch. The default branch is `prod`. Any other branch is
lowercased, every run of characters outside `a-z` and `0-9` becomes one dash,
the dashes at both ends go, and the result is cut to 40 characters without a
trailing dash. A dash and the first 16 hex characters of the SHA-256 of the
branch (UTF-8) always follow, so two branches never share a stage, and a
preview stage is never `prod`. The stage is only the Alchemy state key, so the
long hash costs nothing visible; two branches with the same first 6 hex
characters take seconds to find. The result always matches the Alchemy stage
pattern `^[a-z0-9]+([-_a-z0-9]+)*$`.
*/
export function alchemyStage(args: { branch: string; defaultBranch: string }): string {
  if (args.branch === args.defaultBranch) {
    return "prod";
  }
  const readable = args.branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
    .replace(/-$/, "");
  if (readable === "") {
    throw new Error(
      `The branch ${JSON.stringify(args.branch)} has no letter or digit, so it has no preview stage. Rename the branch.`,
    );
  }
  return `${readable}-${createHash("sha256").update(args.branch).digest("hex").slice(0, 16)}`;
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  const branch = process.env["BRANCH"] ?? "";
  const defaultBranch = process.env["DEFAULT_BRANCH"] ?? "";
  const githubEnv = process.env["GITHUB_ENV"] ?? "";
  if (branch === "" || defaultBranch === "" || githubEnv === "") {
    throw new Error(
      "BRANCH, DEFAULT_BRANCH, and GITHUB_ENV must be set. .github/workflows/alchemy.yml sets them.",
    );
  }
  const stage = alchemyStage({ branch, defaultBranch });
  const isPreview = stage !== "prod";
  const previewName = isPreview ? workerPreviewName(stage, deployNames().worker) : "";
  // Git ref names have no control characters, so a branch fits on one line.
  appendFileSync(
    githubEnv,
    `STAGE=${stage}\nPREVIEW_BRANCH=${isPreview ? branch : ""}\nPREVIEW_NAME=${previewName}\n`,
  );
  console.log(
    isPreview
      ? `The branch ${JSON.stringify(branch)} has the stage ${stage} and the Worker Preview ${previewName}.`
      : `The branch ${JSON.stringify(branch)} has the stage prod.`,
  );
}
