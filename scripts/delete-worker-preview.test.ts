import { describe, expect, it } from "vite-plus/test";

import { deleteWorkerPreview } from "./delete-worker-preview.ts";

const args = {
  accountId: "account",
  token: "token",
  worker: "my-app",
  previewName: "feature-foo-bar-c86457cc23da70e8-c96d28",
};

const answer = (status: number) => () => Promise.resolve(new Response("{}", { status }));

describe("deleteWorkerPreview", () => {
  it("deletes the Preview by name", async () => {
    const requests: { url: string; method: string | undefined }[] = [];
    await expect(
      deleteWorkerPreview(args, (url, init) => {
        requests.push({ url, method: init.method });
        return answer(200)();
      }),
    ).resolves.toBe(true);
    expect(requests).toEqual([
      {
        url: "https://api.cloudflare.com/client/v4/accounts/account/workers/workers/my-app/previews/feature-foo-bar-c86457cc23da70e8-c96d28",
        method: "DELETE",
      },
    ]);
  });

  it("accepts a Preview that does not exist", async () => {
    await expect(deleteWorkerPreview(args, answer(404))).resolves.toBe(false);
  });

  it("fails on any other answer", async () => {
    await expect(deleteWorkerPreview(args, answer(403))).rejects.toThrow("Cloudflare answered 403");
  });
});
