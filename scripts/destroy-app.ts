// Destroys the whole app: the destroy-app job of .github/workflows/alchemy.yml
// runs it after the typed confirmation, with the credentials of the deploy.
//
// 1. A dry run of the deploy below opens the state store with --yes, which
//    upgrades an out-of-date store; the `alchemy state` commands cannot. A
//    stack without state ends the run here.
// 2. The last deploy wrote a removal policy that keeps the Worker and the
//    Convex project, and a destroy reads that policy from state. So it
//    deploys only those two with DESTROY_APP=true (alchemy.run.ts), which
//    rewrites their policy and nothing else.
// 3. `alchemy destroy --stage prod` deletes the Workers Builds link, the
//    deploy keys, the Worker with its Previews, and the Convex project with
//    all its deployments.
// 4. It deletes what the destroy left of the stack's state, so a later
//    repository with the same name starts clean.
//
// `--backend cloudflare` opens the account's default state store, the one
// that `state: Cloudflare.state()` in alchemy.run.ts configures, without
// loading alchemy.run.ts.
/// <reference types="node" />
import { execFileSync } from "node:child_process";
import process from "node:process";

import { deployNames } from "./deploy-names.ts";

const alchemy = (args: string[]) =>
  execFileSync("pnpm", ["exec", "alchemy", ...args], {
    env: { ...process.env, DESTROY_APP: "true" },
    stdio: "inherit",
  });

const { stack } = deployNames();
/** Whether the state store has the stack. The other stacks of the account stay out of the log. */
const hasStack = () =>
  execFileSync("pnpm", ["exec", "alchemy", "state", "list", "--backend", "cloudflare"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  })
    .split("\n")
    .map((line) => line.trim())
    .includes(`${stack}/`);

const deployWorkerAndProject = [
  "deploy",
  "--stage",
  "prod",
  "--include",
  "Worker",
  "--include",
  "Project",
  "--yes",
  "--no-input",
];
alchemy([...deployWorkerAndProject, "--dry-run"]);
if (!hasStack()) {
  console.log(`The state store has no stack ${stack}: nothing to destroy.`);
} else {
  alchemy(deployWorkerAndProject);
  alchemy(["destroy", "--stage", "prod", "--yes", "--no-input"]);
  if (hasStack()) {
    alchemy(["state", "delete", "--recursive", stack, "--backend", "cloudflare"]);
  }
  console.log(`Destroyed the app and deleted the state of the stack ${stack}.`);
}
