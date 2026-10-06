import { describe, expect, it } from "vite-plus/test";

import { shouldProceed } from "./check-branch-head.ts";

// A real GET /repos/actions/checkout/git/ref/heads/test-data%2Fv2%2Fbasic
// response.
const refPayload = {
  ref: "refs/heads/test-data/v2/basic",
  node_id: "MDM6UmVmMTk3ODE0NjI5OnJlZnMvaGVhZHMvdGVzdC1kYXRhL3YyL2Jhc2lj",
  url: "https://api.github.com/repos/actions/checkout/git/refs/heads/test-data/v2/basic",
  object: {
    sha: "82f71901cf8c021332310dcc8cdba84c4193ff5d",
    type: "commit",
    url: "https://api.github.com/repos/actions/checkout/git/commits/82f71901cf8c021332310dcc8cdba84c4193ff5d",
  },
};

const env = {
  BRANCH: "test-data/v2/basic",
  GITHUB_SHA: "82f71901cf8c021332310dcc8cdba84c4193ff5d",
  GITHUB_REPOSITORY: "actions/checkout",
  GITHUB_TOKEN: "token",
  GITHUB_API_URL: "https://api.github.com",
};

const answer = (status: number, body: unknown) => () =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));
const exists = answer(200, refPayload);
const deleted = answer(404, { message: "Not Found" });
// The old name of a renamed branch.
const redirected = answer(301, { message: "Moved Permanently" });
const otherRef = answer(200, { ...refPayload, ref: "refs/heads/test-data/v2/renamed" });

describe("shouldProceed", () => {
  it("deploys while the commit of the run is the head of the exact ref", async () => {
    const requests: { url: string; redirect: RequestInit["redirect"] }[] = [];
    await expect(
      shouldProceed("deploy", env, (url, init) => {
        requests.push({ url, redirect: init.redirect });
        return exists();
      }),
    ).resolves.toBe(true);
    expect(requests).toEqual([
      {
        url: "https://api.github.com/repos/actions/checkout/git/ref/heads/test-data%2Fv2%2Fbasic",
        redirect: "manual",
      },
    ]);
  });

  it("skips the deploy after a newer push, a delete, or a rename", async () => {
    await expect(
      shouldProceed("deploy", { ...env, GITHUB_SHA: "0".repeat(40) }, exists),
    ).resolves.toBe(false);
    for (const missing of [deleted, redirected, otherRef]) {
      await expect(shouldProceed("deploy", env, missing)).resolves.toBe(false);
    }
  });

  it("destroys while the branch does not exist under its name", async () => {
    for (const missing of [deleted, redirected, otherRef]) {
      await expect(shouldProceed("destroy", env, missing)).resolves.toBe(true);
    }
  });

  it("skips the destroy when the branch exists again", async () => {
    await expect(
      shouldProceed("destroy", { ...env, GITHUB_SHA: "0".repeat(40) }, exists),
    ).resolves.toBe(false);
  });

  it("fails on any other GitHub answer", async () => {
    for (const mode of ["deploy", "destroy"] as const) {
      await expect(shouldProceed(mode, env, answer(500, {}))).rejects.toThrow(
        "GitHub answered 500",
      );
      await expect(
        shouldProceed(mode, env, answer(200, { ...refPayload, object: { type: "commit" } })),
      ).rejects.toThrow("no head commit");
    }
  });

  it("fails without the run identity", async () => {
    await expect(shouldProceed("destroy", { ...env, BRANCH: "" }, deleted)).rejects.toThrow(
      "must be set",
    );
  });
});
