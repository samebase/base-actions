// Reads the outputs of this run's stage from the Alchemy state store after
// `alchemy deploy`, and appends VITE_CONVEX_URL to GITHUB_ENV. The app build
// runs in a later step without credentials and bakes the URL into the client
// bundle; the comment on a pull request shows it. Reading the state store
// needs the Cloudflare credentials of the deploy step.
/// <reference types="node" />
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";
import * as Schema from "effect/Schema";

import { deployNames } from "./deploy-names.ts";

const StackOutput = Schema.Struct({ convexUrl: Schema.String });

/**
The outputs in the output of `alchemy state read <stack>/<stage>/output`. The
command prints the outputs as a JSON object; other lines may come before it,
so the object starts at the last line that opens one.
*/
export function parseStackOutput(stdout: string) {
  const start = stdout.lastIndexOf("\n{");
  return Schema.decodeUnknownSync(StackOutput)(
    JSON.parse(stdout.slice(start === -1 ? stdout.indexOf("{") : start + 1)),
  );
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  const stage = process.env["STAGE"] ?? "";
  const githubEnv = process.env["GITHUB_ENV"] ?? "";
  if (stage === "" || githubEnv === "") {
    throw new Error("STAGE and GITHUB_ENV must be set. .github/workflows/alchemy.yml sets them.");
  }
  const stdout = execFileSync(
    "pnpm",
    ["exec", "alchemy", "state", "read", `${deployNames().stack}/${stage}/output`],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  const output = parseStackOutput(stdout);
  appendFileSync(githubEnv, `VITE_CONVEX_URL=${output.convexUrl}\n`);
  console.log(`Convex URL of the stage ${stage}: ${output.convexUrl}`);
}
