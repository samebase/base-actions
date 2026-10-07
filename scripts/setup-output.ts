// The setup output: what this stack tells Samebase about the resources it
// owns, version 1. alchemy.run.ts returns it under the `samebase` key of the
// stack output; scripts/publish-setup-output.ts writes it after a deploy, or
// the failed output after a failed deploy, and scripts/destroy-app.ts after a
// destroy; .github/workflows/alchemy.yml and .github/workflows/destroy.yml
// upload the file as the artifact samebase-setup-output. Samebase reads the
// newest one from the runs on the default branch, whatever their workflow,
// and accepts `deployed` and `destroyed` only from a successful run and
// `failed` only from a failed one.
//
// One section per provider. Each section names its destination (the
// Cloudflare account, the Convex team) and holds one list per kind of
// resource, so a stack with several Workers or several Convex projects lists
// them all. A new kind, such as buckets or email routing, is a new list or a
// new section, and that is a new version: this version rejects every section
// and field it does not define, here before the upload and again in Samebase,
// so nothing unknown is published or read.
//
// Anyone who can read the repository can download the artifact, so no field
// may hold a secret.
/// <reference types="node" />
import { writeFileSync } from "node:fs";

import * as Schema from "effect/Schema";

/** A Convex team or project id. The Convex API returns int64 numbers; Samebase keeps them as decimal strings. */
const DecimalId = Schema.String.check(Schema.isPattern(/^[0-9]+$/));

export const DeployedSetupOutput = Schema.Struct({
  version: Schema.Literal(1),
  state: Schema.Literal("deployed"),
  cloudflare: Schema.Struct({
    accountId: Schema.NonEmptyString,
    workers: Schema.NonEmptyArray(
      Schema.Struct({
        /** The Worker's immutable id, the Workers Builds `script_tag`. */
        tag: Schema.NonEmptyString,
        name: Schema.NonEmptyString,
        /** The Workers Builds root directory, such as `/`. */
        rootDirectory: Schema.NonEmptyString,
      }),
    ),
  }),
  convex: Schema.Struct({
    teamId: DecimalId,
    /**
    Each project names its code the way Samebase does: the convex.json file, or the convex/
    directory of the default layout, relative to the repository root.
    */
    projects: Schema.NonEmptyArray(
      Schema.Union([
        Schema.Struct({ projectId: DecimalId, convexConfigPath: Schema.NonEmptyString }),
        Schema.Struct({ projectId: DecimalId, convexDirectoryPath: Schema.NonEmptyString }),
      ]),
    ),
  }),
});
export type DeployedSetupOutput = typeof DeployedSetupOutput.Type;

/** Written only after `alchemy destroy` ran. It reports the run; Samebase still reads the providers. */
export const DESTROYED_SETUP_OUTPUT = { version: 1, state: "destroyed" } as const;

/**
Written when a step of the deploy job failed, so Samebase shows the failed run instead of waiting
for an output. A failed destroy writes nothing: it stays in GitHub.
*/
export const FAILED_SETUP_OUTPUT = { version: 1, state: "failed" } as const;

export const SETUP_OUTPUT_FILE = "samebase-setup-output.json";

/** The `samebase` value of a deploy, with every field checked and no other field allowed. */
export const decodeDeployedSetupOutput = Schema.decodeUnknownSync(DeployedSetupOutput, {
  onExcessProperty: "error",
});

export function writeSetupOutput(
  output: DeployedSetupOutput | typeof DESTROYED_SETUP_OUTPUT | typeof FAILED_SETUP_OUTPUT,
): void {
  writeFileSync(SETUP_OUTPUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
}
