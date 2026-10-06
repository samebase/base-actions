// The deploy stack of this app. One stack owns the Convex backend and the
// Cloudflare Worker, and pushes code to both on every deploy.
//
// - Stage `prod` (push to main): the Convex project and its production
//   deployment, the Convex Auth keys, the functions push, and the Worker.
// - Stage `pr-<number>` (a pull request): PREVIEW_BRANCH holds the branch. A
//   Convex preview deployment named after the branch, the name `npx convex
//   deploy --preview-name` gives it, and a Worker Preview of the prod Worker
//   named after the stage. `alchemy destroy --stage pr-<number>` deletes both.
// - No other stage. `pnpm run dev` runs Convex and Vite without Alchemy.
//
// .github/workflows/alchemy.yml runs the deploys. A deploy from a laptop needs
// GITHUB_REPOSITORY (`<owner>/<repository>`), CONVEX_TEAM_ID,
// CLOUDFLARE_API_TOKEN, and CLOUDFLARE_ACCOUNT_ID in the environment or in
// .env, and CONVEX_ACCESS_TOKEN or the Convex CLI login:
//   pnpm exec alchemy deploy --stage prod
import * as Convex from "@samebase/alchemy-convex";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as GitHub from "alchemy/GitHub";
import * as Output from "alchemy/Output";
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { createPublicKey } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

// Alchemy reads the stack name when it loads this file, before the stack has
// its config, so this reads the process environment over .env, in the same
// order as the Alchemy CLI.
const startupConfig = existsSync(".env")
  ? ConfigProvider.orElse(
      ConfigProvider.fromEnv(),
      ConfigProvider.fromDotEnvContents(readFileSync(".env", "utf8")),
    )
  : ConfigProvider.fromEnv();
const repository = Effect.runSync(
  Config.String("GITHUB_REPOSITORY").pipe(Config.withDefault("")).parse(startupConfig),
);
const repositoryMatch = /^([^/]+)\/([^/]+)$/.exec(repository);
if (repositoryMatch === null) {
  throw new Error(
    `GITHUB_REPOSITORY is "${repository}", not "<owner>/<repository>". GitHub Actions sets it. For a deploy from a laptop, set it in the environment or in .env.`,
  );
}
const [, repositoryOwner, repositoryName] = repositoryMatch;

// Alchemy keys state by stack name and stage, and all stacks of a Cloudflare
// account share one state store. The stack name is the owner and the
// repository, lowercase, joined with `_`. GitHub names ignore case, and an
// owner name has no `_`, so two repositories never share a stack. Alchemy
// does not check stack names; it puts the name in a state store URL path, a
// local state directory, and a Worker tag. Owner and repository names have
// only letters, digits, `-`, `.`, and `_`: no escaping in a URL path or a
// directory name, and no `,` or `&`, which Cloudflare asks to avoid in tags.
const stackName = `${repositoryOwner}_${repositoryName}`.toLowerCase();

// The Worker and the Convex project take the repository name the way Samebase
// names resources: lowercase, every run of other characters as one dash, no
// dash at the ends, cut to 54 characters for a Worker with preview URLs and 40
// for a Convex project.
const resourceName = (maxLength: number) =>
  repositoryName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/, "");
const workerName = resourceName(54);
const convexProjectName = resourceName(40);
if (workerName === "") {
  throw new Error(`The repository name "${repositoryName}" has no letter or digit.`);
}

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
    name: convexProjectName,
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
  stackName,
  {
    providers: Layer.mergeAll(Cloudflare.providers(), GitHub.providers(), Convex.providers()),
    // The Cloudflare state store: an encrypted Durable Object in the account,
    // shared by the laptop and GitHub Actions.
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    // .github/workflows/alchemy.yml sets PREVIEW_BRANCH to the pull request
    // branch and the stage to pr-<number>. Both are empty or prod on a push.
    const previewBranch = yield* Config.String("PREVIEW_BRANCH").pipe(Config.withDefault(""));
    const isPreview = /^pr-\d+$/.test(stage);
    if (stage === "prod" && previewBranch !== "") {
      return yield* Effect.die(
        new Error(
          `PREVIEW_BRANCH is "${previewBranch}" on stage prod. A preview never deploys as prod.`,
        ),
      );
    }
    if (isPreview && previewBranch === "") {
      return yield* Effect.die(
        new Error(
          `Stage "${stage}" is a pull request stage, and PREVIEW_BRANCH is empty. Set it to the branch of the pull request.`,
        ),
      );
    }
    if (stage !== "prod" && !isPreview) {
      return yield* Effect.die(
        new Error(
          `Stage "${stage}" is not prod or pr-<number>. This stack deploys only those stages.`,
        ),
      );
    }
    // The Worker Preview takes the stage as its name. Cloudflare serves it at
    // `<stage>-<worker>.<subdomain>.workers.dev`, so `<stage>-<worker>` must
    // fit in one 63-character DNS label. A name is never cut, so two pull
    // requests never share a Preview.
    const previewNameBudget = 63 - workerName.length - 1;
    if (isPreview && stage.length > previewNameBudget) {
      return yield* Effect.die(
        new Error(
          `Stage "${stage}" does not fit next to the Worker name "${workerName}" in a 63-character DNS label: the pull request number is too large for this Worker name, which leaves ${previewNameBudget} characters. Rename the repository to a shorter name.`,
        ),
      );
    }

    const backend = isPreview ? yield* preview(previewBranch) : yield* production;

    // The same settings as wrangler.jsonc in the Workers Builds template.
    // VITE_ variables go into the client bundle as import.meta.env.VITE_*.
    const settings = {
      compatibility: { date: "2026-05-14" },
      assets: {
        htmlHandling: "none",
        // Cloudflare SPA mode serves /index.html for unknown app routes.
        // vite.config.ts emits the TanStack Start shell there.
        notFoundHandling: "single-page-application",
      },
      env: { VITE_CONVEX_URL: backend.url },
    } as const;

    const site = isPreview
      ? yield* Cloudflare.Website.Vite("Website", {
          ...settings,
          preview: { of: yield* Cloudflare.Worker.ref("Website", { stage: "prod" }), name: stage },
        })
      : yield* Cloudflare.Website.Vite("Website", { ...settings, name: workerName });

    const github = yield* GitHub.GitHubEnv;
    if (github?.pr) {
      yield* GitHub.Comment("PreviewComment", {
        owner: github.owner,
        repository: github.repository,
        issueNumber: github.pr,
        body: Output.interpolate`
          **Preview:** ${site.url}

          Convex: ${backend.url}

          Built from commit ${github.sha.slice(0, 7)}. Alchemy updates this comment on each push.
        `,
      });
    }

    return { url: site.url, convexUrl: backend.url };
  }),
);
