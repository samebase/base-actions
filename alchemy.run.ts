// The setup stack of this app. Workers Builds deploys the app on every push;
// this stack declares the setup around it, following the Samebase research
// note "Alchemy setup stacks next to Workers Builds"
// (research/2026-10-05-alchemy-setup-stack-and-wrangler-split.md in the
// Samebase repository): the stack owns wiring, not settings, and each field
// has one owner.
//
// - This stack: the Worker shell, the Workers Builds link with its build
//   variables, the Convex project, and the two Convex deploy keys of the
//   builds. It never uploads Worker code.
// - wrangler.jsonc: everything of the Worker version. It has no `name`:
//   Workers Builds deploys to the Worker it is connected to, whose name this
//   stack gives from the repository (scripts/deploy-names.ts).
//
// .github/workflows/alchemy.yml runs it on its one stage, prod. A deploy from
// a laptop needs GITHUB_REPOSITORY, CONVEX_TEAM_ID, CLOUDFLARE_API_TOKEN, and
// CLOUDFLARE_ACCOUNT_ID in the environment or in .env, CONVEX_ACCESS_TOKEN or
// the Convex CLI login, and GITHUB_TOKEN for a private repository:
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
import * as Schema from "effect/Schema";

import { deployNames } from "./scripts/deploy-names.ts";

const names = deployNames();

/**
 * Whether a destroy keeps the Worker and the Convex project: yes, unless
 * DESTROY_APP is set. Alchemy reads a removal policy from the state that the
 * last deploy wrote, so scripts/destroy-app.ts deploys these two with
 * DESTROY_APP=true before it destroys the stage.
 */
const keepProductionApp = Effect.gen(function* () {
  return !(yield* Config.Boolean("DESTROY_APP").pipe(Config.withDefault(false)));
}).pipe(Effect.orDie);

/**
 * Starts the first production build. Samebase pushes the starter to main
 * before this stack creates the Builds link, and creating a link starts no
 * build, so without this the Worker has no version until the next push to
 * main. An Action runs again only when its input changes: a new Worker or
 * another production branch, or `alchemy deploy --force`.
 */
const FirstBuild = Alchemy.Action(
  "FirstBuild",
  Effect.fn(function* (link: { accountId: string; scriptTag: string; branch: string }) {
    const token = yield* Config.Redacted("CLOUDFLARE_API_TOKEN");
    const request = (path: string, init?: { method: "POST"; body: string }) =>
      Effect.tryPromise({
        try: async () => {
          const response = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${link.accountId}/builds${path}`,
            {
              ...init,
              headers: {
                authorization: `Bearer ${Redacted.value(token)}`,
                "content-type": "application/json",
              },
            },
          );
          // Cloudflare answers some errors with a body that is not JSON.
          const text = await response.text();
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${text}`);
          }
          const body: unknown = JSON.parse(text);
          return body;
        },
        catch: (cause) => new Error(`The Workers Builds request ${path} failed. ${String(cause)}`),
      });

    const { result: triggers } = Schema.decodeUnknownSync(
      Schema.Struct({
        result: Schema.Array(
          Schema.Struct({
            trigger_uuid: Schema.String,
            branch_includes: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
            deleted_on: Schema.optionalKey(Schema.NullOr(Schema.String)),
          }),
        ),
      }),
    )(yield* request(`/workers/${link.scriptTag}/triggers`));
    // The production trigger builds exactly the production branch.
    const production = triggers.filter(
      (trigger) =>
        !trigger.deleted_on &&
        trigger.branch_includes?.length === 1 &&
        trigger.branch_includes[0] === link.branch,
    );
    if (production.length !== 1) {
      return yield* Effect.die(
        new Error(
          `Workers Builds has ${production.length} production triggers for ${link.branch}, not one. Start the first build in the Cloudflare dashboard.`,
        ),
      );
    }

    // With only the branch, Workers Builds builds the head of the branch.
    yield* request(`/triggers/${production[0].trigger_uuid}/builds`, {
      method: "POST",
      body: JSON.stringify({ branch: link.branch }),
    });
    return { triggerUuid: production[0].trigger_uuid };
  }),
);

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
    // Another stage would own the same Worker and Convex project.
    const { stage } = yield* Alchemy.Stack;
    if (stage !== "prod") {
      return yield* Effect.die(
        new Error(`Stage "${stage}" is not prod. Deploy with --stage prod.`),
      );
    }

    // A Worker or a project with this name that the stack did not create
    // stops the deploy until `alchemy deploy --adopt`.
    const shell = yield* WorkersBuilds.Worker("Worker", { name: names.worker }).pipe(
      Alchemy.RemovalPolicy.retain(keepProductionApp),
    );
    const project = yield* Convex.Project("Project", {
      team: yield* Config.Int("CONVEX_TEAM_ID"),
      name: names.convexProject,
    }).pipe(Alchemy.RemovalPolicy.retain(keepProductionApp));

    // The production key gets only what scripts/build-cloudflare.ts and
    // scripts/ensure-convex-auth.ts need. Without allowedActions, Convex
    // grants every deployment action.
    const deployKey = yield* Convex.DeployKey("DeployKey", {
      deployment: Output.map(project.prodDeploymentName, (name) => {
        if (!name) {
          throw new Error(
            `The Convex project ${names.convexProject} has no production deployment.`,
          );
        }
        return name;
      }),
      name: "workers-builds",
      allowedActions: [
        "deployment:deploy",
        "deployment:env:view",
        "deployment:env:write",
        "deployment:data:view",
      ],
    });
    const previewKey = yield* Convex.PreviewDeployKey("PreviewDeployKey", {
      projectId: project.projectId,
      name: "workers-builds",
    });

    // The provider reads the default branch, main, as the production branch.
    // Worker Previews and build caching keep their defaults: on.
    const builds = yield* WorkersBuilds.Repository("Builds", {
      worker: shell.workerId,
      repository: names.repository,
      buildCommand: "pnpm run build",
      deployCommand: "pnpm run deploy",
      previewDeployCommand: "pnpm run deploy:preview",
      // scripts/build-cloudflare.ts reads CONVEX_DEPLOY_KEY. Samebase reads
      // SAMEBASE_CONVEX_PROJECT to link the Worker to its Convex project.
      variables: {
        CONVEX_DEPLOY_KEY: deployKey.deployKey,
        SAMEBASE_CONVEX_PROJECT: Output.interpolate`version=1&teamId=${project.teamId}&projectId=${project.projectId}`,
      },
      previewVariables: { CONVEX_DEPLOY_KEY: previewKey.previewDeployKey },
    });

    yield* FirstBuild({
      accountId: builds.accountId,
      scriptTag: builds.scriptTag,
      branch: builds.repository.branch,
    });

    return { workerUrl: shell.url, convexUrl: project.prodDeploymentUrl };
  }),
);
