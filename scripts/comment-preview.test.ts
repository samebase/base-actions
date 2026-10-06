import { describe, expect, it } from "vite-plus/test";

import { commentPreview } from "./comment-preview.ts";

// Fields of real GET /repos/actions/checkout/pulls?state=open and
// GET /repos/actions/checkout/issues/comments responses.
const pullRequests = [{ number: 2593 }, { number: 2590 }];
const otherComment = { id: 6015133000, user: { login: "Jellyfrog" }, body: "ping @allanguigou " };

const env = {
  GITHUB_API_URL: "https://api.github.com",
  GITHUB_REPOSITORY: "actions/checkout",
  GITHUB_REPOSITORY_OWNER: "actions",
  GITHUB_TOKEN: "token",
  GITHUB_SHA: "82f71901cf8c021332310dcc8cdba84c4193ff5d",
  PREVIEW_BRANCH: "feature/Foo_bar",
  PREVIEW_URL: "https://feature-foo-bar-c86457cc23da70e8-c96d28-my-app.example.workers.dev",
  VITE_CONVEX_URL: "https://example-animal-123.convex.cloud",
};

function gitHub(answers: Record<string, unknown>) {
  const requests: { method: string; url: string; body: unknown }[] = [];
  const fetchGitHub = (url: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    requests.push({
      method,
      url,
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const answer = answers[`${method} ${url}`];
    return Promise.resolve(
      answer === undefined
        ? new Response("{}", { status: 404 })
        : new Response(JSON.stringify(answer), { status: 200 }),
    );
  };
  return { requests, fetchGitHub };
}

const pulls =
  "GET https://api.github.com/repos/actions/checkout/pulls?state=open&head=actions%3Afeature%2FFoo_bar";
const comments = (page: number) =>
  `GET https://api.github.com/repos/actions/checkout/issues/2590/comments?per_page=100&page=${page}`;
const ownComment = {
  id: 7,
  user: { login: "github-actions[bot]" },
  body: "<!-- alchemy-preview -->\nold",
};

describe("commentPreview", () => {
  it("does nothing when no pull request from the branch is open", async () => {
    const { requests, fetchGitHub } = gitHub({ [pulls]: [] });
    await expect(commentPreview(env, fetchGitHub)).resolves.toBeUndefined();
    expect(requests).toHaveLength(1);
  });

  it("creates the comment on the oldest open pull request", async () => {
    const { requests, fetchGitHub } = gitHub({
      [pulls]: pullRequests,
      [comments(1)]: [otherComment],
      "POST https://api.github.com/repos/actions/checkout/issues/2590/comments": {},
    });
    await expect(commentPreview(env, fetchGitHub)).resolves.toBe(2590);
    expect(requests.at(-1)?.body).toEqual({
      body: `<!-- alchemy-preview -->
**Preview:** ${env.PREVIEW_URL}

Convex: ${env.VITE_CONVEX_URL}

Built from commit 82f7190. This comment is updated on each push.`,
    });
  });

  it("updates its own comment on a later push", async () => {
    const { requests, fetchGitHub } = gitHub({
      [pulls]: [{ number: 2590 }],
      [comments(1)]: [otherComment, ownComment],
      "PATCH https://api.github.com/repos/actions/checkout/issues/comments/7": {},
    });
    await expect(commentPreview(env, fetchGitHub)).resolves.toBe(2590);
    expect(requests.at(-1)?.method).toBe("PATCH");
  });

  it("finds its own comment on a later page", async () => {
    const { requests, fetchGitHub } = gitHub({
      [pulls]: [{ number: 2590 }],
      [comments(1)]: Array.from({ length: 100 }, () => otherComment),
      [comments(2)]: [otherComment, ownComment],
      "PATCH https://api.github.com/repos/actions/checkout/issues/comments/7": {},
    });
    await expect(commentPreview(env, fetchGitHub)).resolves.toBe(2590);
    expect(requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
      pulls,
      comments(1),
      comments(2),
      "PATCH https://api.github.com/repos/actions/checkout/issues/comments/7",
    ]);
  });

  it("fails on a GitHub error and without the run identity", async () => {
    await expect(commentPreview(env, gitHub({}).fetchGitHub)).rejects.toThrow(
      "GitHub answered 404",
    );
    await expect(commentPreview({ ...env, PREVIEW_URL: "" })).rejects.toThrow(
      "PREVIEW_URL must be set",
    );
  });
});
