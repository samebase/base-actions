// Uploads the Preview Build Output of a branch other than the default branch
// as the Worker Preview PREVIEW_NAME, and appends its URL to GITHUB_ENV as
// PREVIEW_URL for the pull request comment. The default branch runs
// `cf deploy --prebuilt` instead.
//
// cf takes the Preview name as given (no change on the client), creates the
// Preview when no Preview of the Worker has that name, and otherwise adds a
// deployment to it. scripts/alchemy-stage.ts computes the name with
// workerPreviewName, which keeps it inside what Cloudflare accepts.
/// <reference types="node" />
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as Schema from "effect/Schema";

const PreviewDeploy = Schema.Struct({
  preview_name: Schema.String,
  preview_urls: Schema.NonEmptyArray(Schema.String),
});

/**
The result in the output of `cf previews deploy`. cf prints the result as a
JSON object; progress lines may come before it, so the object starts at the
last line that opens one.
*/
export function parsePreviewDeploy(stdout: string) {
  const start = stdout.lastIndexOf("\n{");
  return Schema.decodeUnknownSync(PreviewDeploy)(
    JSON.parse(stdout.slice(start === -1 ? stdout.indexOf("{") : start + 1)),
  );
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  const previewName = process.env["PREVIEW_NAME"] ?? "";
  const githubEnv = process.env["GITHUB_ENV"] ?? "";
  if (previewName === "" || githubEnv === "") {
    throw new Error(
      "PREVIEW_NAME and GITHUB_ENV must be set. .github/workflows/alchemy.yml sets them on a branch other than the default branch.",
    );
  }
  const cf = fileURLToPath(new URL("./bin/cf", import.meta.resolve("cf/package.json")));
  const stdout = execFileSync(
    process.execPath,
    [cf, "previews", "deploy", "--prebuilt", previewName],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  const preview = parsePreviewDeploy(stdout);
  if (preview.preview_name !== previewName) {
    throw new Error(
      `cf deployed the Worker Preview "${preview.preview_name}", not "${previewName}". scripts/delete-worker-preview.ts would not find it.`,
    );
  }
  const [url] = preview.preview_urls;
  appendFileSync(githubEnv, `PREVIEW_URL=${url}\n`);
  console.log(`Worker Preview ${previewName}: ${url}`);
}
