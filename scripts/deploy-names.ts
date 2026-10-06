// The names of the resources that the setup stack owns. alchemy.run.ts and
// scripts/destroy-app.ts import them from here, so each name has one owner.
/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";
import { parseEnv } from "node:util";

/**
GITHUB_REPOSITORY (`<owner>/<repository>`) from the environment, or from .env
on a laptop. GitHub Actions sets it. The Alchemy CLI reads .env into its own
config, not into process.env, and alchemy.run.ts needs the names on import.
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

- `repository`: the owner and the name, for the Workers Builds link.
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
    repository: { owner, name },
    stack: `${owner}_${name}`.toLowerCase(),
    worker,
    convexProject: resourceName(40),
  };
}
