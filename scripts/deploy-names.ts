// The names of the deploy resources of this app. alchemy.run.ts,
// cloudflare.config.ts, and the workflow scripts import them from here, so
// each name has one owner.
/// <reference types="node" />
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";
import { parseEnv } from "node:util";

/**
GITHUB_REPOSITORY (`<owner>/<repository>`) from the environment, or from .env
for a deploy or a build on a laptop. GitHub Actions sets it.
*/
function repositoryFromEnvironment(): string {
  const value = process.env["GITHUB_REPOSITORY"];
  if (value) {
    return value;
  }
  return existsSync(".env")
    ? (parseEnv(readFileSync(".env", "utf8"))["GITHUB_REPOSITORY"] ?? "")
    : "";
}

/**
The names that come from the GitHub repository.

- `stack`: the Alchemy stack. Alchemy keys state by stack name and stage, and
  all stacks of a Cloudflare account share one state store, so the name is the
  owner and the repository, lowercase, joined with `_`. GitHub names ignore
  case, and an owner name has no `_`, so two repositories never share a stack.
  Owner and repository names have only letters, digits, `-`, `.`, and `_`: no
  escaping in the state store URL path, the local state directory, or a Worker
  tag.
- `worker` and `convexProject`: the repository name the way Samebase names
  resources: lowercase, every run of other characters as one dash, no dash at
  the ends, cut to 54 characters for a Worker with Preview URLs and 40 for a
  Convex project.
*/
export function deployNames(repository = repositoryFromEnvironment()) {
  const match = /^([^/]+)\/([^/]+)$/.exec(repository);
  if (match === null) {
    throw new Error(
      `GITHUB_REPOSITORY is "${repository}", not "<owner>/<repository>". GitHub Actions sets it. On a laptop, set it in the environment or in .env.`,
    );
  }
  const [, owner, name] = match;
  const resourceName = (maxLength: number) =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, maxLength)
      .replace(/-+$/, "");
  const worker = resourceName(54);
  if (worker === "") {
    throw new Error(`The repository name "${name}" has no letter or digit.`);
  }
  return {
    stack: `${owner}_${name}`.toLowerCase(),
    worker,
    convexProject: resourceName(40),
  };
}

/**
The name of the Worker Preview of a preview stage, which `cf previews deploy`
uploads and scripts/delete-worker-preview.ts deletes. Cloudflare serves the
Preview at `<name>-<worker>.<subdomain>.workers.dev`, so `<name>-<worker>`
must fit in one 63-character DNS label, and the name must start with a
lowercase letter. The name is a readable part, a dash, and the first 6 hex
characters of the SHA-256 of the whole stage. The readable part is the stage,
with `p` first when the stage does not start with a letter, cut to fit without
a trailing dash. Branch names are often long, so the cut is the normal case
for a long Worker name. Two stages get one name only in rare cases, more often
with a long Worker name: 6 hex characters keep the URL short, and a
54-character Worker name leaves room for only 8 characters. Samebase computes
the same name to find the Preview.
*/
export function workerPreviewName(stage: string, worker: string): string {
  const budget = 63 - worker.length - 1;
  if (budget < 8) {
    throw new Error(
      `The Worker name "${worker}" leaves ${budget} characters for a Worker Preview name in a 63-character DNS label, and a Preview name needs 8. Use a shorter repository name.`,
    );
  }
  const readable = (/^[a-z]/.test(stage) ? stage : `p${stage}`)
    .slice(0, budget - 7)
    .replace(/-+$/, "");
  const name = `${readable}-${createHash("sha256").update(stage).digest("hex").slice(0, 6)}`;
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new Error(
      `Stage "${stage}" gives the Worker Preview name "${name}", which has characters other than a-z, 0-9, and dashes. Deploy a preview with the stage that scripts/alchemy-stage.ts computes.`,
    );
  }
  return name;
}
