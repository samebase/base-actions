// Writes the setup output of the last deploy to samebase-setup-output.json.
// The deploy job of .github/workflows/alchemy.yml runs it right after
// `alchemy deploy` and uploads the file as the artifact samebase-setup-output;
// scripts/setup-output.ts defines the contract.
//
// With --failed it writes the failed output instead and reads nothing: the
// deploy job runs it when one of its steps failed. It imports the installed
// dependencies like any run, so a job that failed before its install uploads
// nothing, and Samebase keeps waiting for an output.
//
// `--backend cloudflare` opens the account's default state store, the one
// that `state: Cloudflare.state()` in alchemy.run.ts configures, without
// loading alchemy.run.ts.
/// <reference types="node" />
import { execFileSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

import * as Schema from "effect/Schema";

import { deployNames } from "./deploy-names.ts";
import {
  decodeDeployedSetupOutput,
  FAILED_SETUP_OUTPUT,
  SETUP_OUTPUT_FILE,
  writeSetupOutput,
} from "./setup-output.ts";

/** Other outputs of the stack stay out of the file. */
const StackOutput = Schema.Struct({ samebase: Schema.Unknown });

/**
The checked `samebase` value from what `alchemy state read <stack>/prod/output`
prints: log lines first, such as "Refreshing Cloudflare State Store
credentials", then the stack output as JSON whose first line is a lone `{`.
*/
export function readSetupOutput(printed: string) {
  const start = printed.search(/^\{$/m);
  if (start < 0) {
    throw new Error(
      "`alchemy state read` printed no stack output. A deploy that succeeds writes one; a deploy with --include does not.",
    );
  }
  const stackOutput = Schema.decodeUnknownSync(StackOutput)(JSON.parse(printed.slice(start)));
  return decodeDeployedSetupOutput(stackOutput.samebase);
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  if (process.argv.includes("--failed")) {
    writeSetupOutput(FAILED_SETUP_OUTPUT);
    console.log(`Wrote the failed setup output to ${SETUP_OUTPUT_FILE}.`);
  } else {
    const { stack } = deployNames();
    const printed = execFileSync(
      "pnpm",
      ["exec", "alchemy", "state", "read", "--backend", "cloudflare", `${stack}/prod/output`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    );
    writeSetupOutput(readSetupOutput(printed));
    console.log(`Wrote ${SETUP_OUTPUT_FILE} for the stack ${stack}.`);
  }
}
