// Deletes the Worker Preview of a deleted branch, after `alchemy destroy` has
// deleted its Convex preview deployment. cf 1.0.0-beta.12 has no command for
// it. The Workers API takes the Preview name where it names a Preview, as cf
// does for its own Preview reads and updates, so one DELETE by name is enough.
// A Preview that does not exist (the branch never deployed one, or a rerun)
// is not an error.
/// <reference types="node" />
import process from "node:process";
import { pathToFileURL } from "node:url";

import { deployNames } from "./deploy-names.ts";

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** Deletes the Preview. Returns false when the Worker has no Preview with that name. */
export async function deleteWorkerPreview(
  args: { accountId: string; token: string; worker: string; previewName: string },
  fetchCloudflare: Fetch = fetch,
): Promise<boolean> {
  const response = await fetchCloudflare(
    `https://api.cloudflare.com/client/v4/accounts/${args.accountId}/workers/workers/${encodeURIComponent(args.worker)}/previews/${encodeURIComponent(args.previewName)}`,
    { method: "DELETE", headers: { authorization: `Bearer ${args.token}` } },
  );
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    throw new Error(
      `Cloudflare answered ${response.status} to the delete of the Worker Preview "${args.previewName}" of "${args.worker}": ${await response.text()}`,
    );
  }
  return true;
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  const accountId = process.env["CLOUDFLARE_ACCOUNT_ID"] ?? "";
  const token = process.env["CLOUDFLARE_API_TOKEN"] ?? "";
  const previewName = process.env["PREVIEW_NAME"] ?? "";
  if (accountId === "" || token === "" || previewName === "") {
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, and PREVIEW_NAME must be set. .github/workflows/alchemy.yml sets them.",
    );
  }
  const worker = deployNames().worker;
  const deleted = await deleteWorkerPreview({ accountId, token, worker, previewName });
  console.log(
    deleted
      ? `Deleted the Worker Preview ${previewName} of ${worker}.`
      : `The Worker ${worker} has no Preview ${previewName}.`,
  );
}
