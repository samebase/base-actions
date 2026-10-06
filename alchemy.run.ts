// The setup stack of this app. It declares the Worker shell, the Convex side,
// and the wiring between them, and pushes the Convex functions. It never
// uploads Worker code: cloudflare.config.ts defines the Worker, and
// .github/workflows/alchemy.yml builds it and uploads it with `cf` after this
// stack deploys. The Worker name comes from cloudflare.config.ts.
//
// - Stage `prod` (a push to the default branch): the Worker shell, the Convex
//   project and its production deployment, the Convex Auth keys, and the
//   functions push.
// - Any other stage is the preview of one branch (a push to any other
//   branch). PREVIEW_BRANCH holds the branch, and scripts/alchemy-stage.ts
//   computes the stage from it. A Convex preview deployment named after the
//   branch, the name `npx convex deploy --preview-name` gives it, and the
//   functions push. When the branch is deleted, `alchemy destroy --stage
//   <stage>` deletes the preview deployment.
// - `pnpm run dev` runs Convex and Vite without Alchemy.
//
// The outputs: `convexUrl` on every stage, which the workflow reads for the
// app build, and `workerUrl`, the workers.dev URL of the Worker, on prod.
//
// A deploy from a laptop needs GITHUB_REPOSITORY (`<owner>/<repository>`),
// CONVEX_TEAM_ID, CLOUDFLARE_API_TOKEN, and CLOUDFLARE_ACCOUNT_ID in the
// environment or in .env, and CONVEX_ACCESS_TOKEN or the Convex CLI login:
//   pnpm exec alchemy deploy --stage prod
import * as WorkersBuilds from "@samebase/alchemy-cloudflare-workers-builds";
import * as Convex from "@samebase/alchemy-convex";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { createPublicKey } from "node:crypto";

import { worker } from "./cloudflare.config.ts";
import { deployNames } from "./scripts/deploy-names.ts";

const names = deployNames();

// Convex Auth reads JWT_PRIVATE_KEY (PKCS#8 PEM, line breaks as spaces) and
// JWKS (the public key as a JSON Web Key Set). Same format as
// scripts/ensure-convex-auth.ts.
const authVariables = (keys: Alchemy.KeyPair) => ({
  JWT_PRIVATE_KEY: Output.map(keys.privateKey, (pem) =>
    Redacted.make(Redacted.value(pem).trimEnd().replace(/\n/g, " ")),
  ),
  JWKS: Output.map(keys.publicKey, (pem) =>
    JSON.stringify({ keys: [{ use: "sig", ...createPublicKey(pem).export({ format: "jwk" }) }] }),
  ),
});

/** The project, its production deployment, the auth keys, and the push. */
const production = Effect.gen(function* () {
  // An unset repository variable reaches the workflow as an empty string.
  const teamId = yield* Config.String("CONVEX_TEAM_ID").pipe(Config.withDefault(""));
  if (!/^\d+$/.test(teamId)) {
    return yield* Effect.die(
      new Error(
        `CONVEX_TEAM_ID is "${teamId}", not the numeric id of a Convex team. Set the repository variable CONVEX_TEAM_ID. For a deploy from a laptop, set it in the environment or in .env.`,
      ),
    );
  }

  const project = yield* Convex.Project("Project", {
    team: Number(teamId),
    name: names.convexProject,
  });
  const deployment = yield* Convex.Deployment("Deployment", {
    projectId: project.projectId,
    type: "prod",
  });
  const key = yield* Convex.DeployKey("DeployKey", {
    deployment: deployment.name,
    name: "alchemy",
    allowedActions: [
      "deployment:deploy",
      "deployment:env:view",
      "deployment:env:write",
      "deployment:data:view",
    ],
  });

  // Preview and dev deployments get their auth keys as project defaults:
  // a preview deploy key cannot set variables, and Convex copies the
  // defaults into each new deployment of that type.
  const nonProduction = authVariables(
    yield* Alchemy.KeyPair("NonProductionJwtKey", { algorithm: "rsa" }),
  );
  for (const deploymentType of ["preview", "dev"] as const) {
    for (const [name, value] of Object.entries(nonProduction)) {
      yield* Convex.DefaultEnvironmentVariable(`${deploymentType}-${name}`, {
        projectId: project.projectId,
        deploymentType,
        name,
        value,
      });
    }
  }

  return yield* Convex.Code("Functions", {
    deployment,
    deployKey: key.deployKey,
    cwd: ".",
    env: authVariables(yield* Alchemy.KeyPair("JwtKey", { algorithm: "rsa" })),
  });
});

/**
 * A preview deployment of the project that stage `prod` owns, and the push.
 * The deployment is named after the branch, like the preview that `npx convex
 * deploy --preview-name <branch>` makes, so a reader finds it under one name
 * on both deploy paths.
 */
const preview = (branch: string) =>
  Effect.gen(function* () {
    const project = yield* Convex.Project.ref("Project", { stage: "prod" });
    const deployment = yield* Convex.Deployment("Deployment", {
      projectId: project.projectId,
      type: "preview",
      name: branch,
    }).pipe(Alchemy.RemovalPolicy.destroy());
    const key = yield* Convex.PreviewDeployKey("PreviewDeployKey", {
      projectId: project.projectId,
      name: "alchemy",
    });
    return yield* Convex.Code("Functions", {
      deployment,
      deployKey: key.previewDeployKey,
      cwd: ".",
    });
  });

export default Alchemy.Stack(
  names.stack,
  {
    providers: Layer.mergeAll(
      Cloudflare.providers(),
      WorkersBuilds.providers(),
      Convex.providers(),
    ),
    // The Cloudflare state store: an encrypted Durable Object in the account,
    // shared by the laptop and GitHub Actions.
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    // scripts/alchemy-stage.ts sets the stage and PREVIEW_BRANCH in
    // .github/workflows/alchemy.yml: prod and empty on the default branch, the
    // stage of the branch and the branch itself on any other branch.
    const previewBranch = yield* Config.String("PREVIEW_BRANCH").pipe(Config.withDefault(""));
    const isPreview = stage !== "prod";
    if (!isPreview && previewBranch !== "") {
      return yield* Effect.die(
        new Error(
          `PREVIEW_BRANCH is "${previewBranch}" on stage prod. A preview never deploys as prod.`,
        ),
      );
    }
    if (isPreview && previewBranch === "") {
      return yield* Effect.die(
        new Error(
          `Stage "${stage}" is a preview stage, and PREVIEW_BRANCH is empty. Set it to the branch of the preview.`,
        ),
      );
    }

    if (isPreview) {
      const backend = yield* preview(previewBranch);
      return { convexUrl: backend.url };
    }

    // Only the name: every other Worker setting stays with cloudflare.config.ts,
    // which `cf deploy` uploads. Retained on destroy, because it is the
    // production Worker of the app. A Worker with this name that the stack did
    // not create stops the deploy until `alchemy deploy --adopt`.
    const shell = yield* WorkersBuilds.Worker("Worker", { name: worker.name }).pipe(
      Alchemy.RemovalPolicy.retain(),
    );
    const backend = yield* production;
    return { convexUrl: backend.url, workerUrl: shell.url };
  }),
);
