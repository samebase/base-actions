// Posts the URLs of a branch preview on the open pull request from that
// branch, and updates the same comment on each later push. When no pull
// request from the branch is open, it does nothing: a pull request opened
// after the last push gets the comment on the next push.
/// <reference types="node" />
import process from "node:process";
import { pathToFileURL } from "node:url";
import * as Schema from "effect/Schema";

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

// The comment that this script wrote: the marker is hidden in the rendered
// Markdown.
const marker = "<!-- alchemy-preview -->";

const PullRequests = Schema.Array(Schema.Struct({ number: Schema.Number }));
const Comments = Schema.Array(
  Schema.Struct({
    id: Schema.Number,
    body: Schema.optional(Schema.String),
    user: Schema.NullOr(Schema.Struct({ login: Schema.String })),
  }),
);

/**
Writes the preview comment on the oldest open pull request from the branch.
Returns the pull request number, or undefined when none is open.
*/
export async function commentPreview(
  env: NodeJS.ProcessEnv,
  fetchGitHub: Fetch = fetch,
): Promise<number | undefined> {
  const required = (name: string) => {
    const value = env[name] ?? "";
    if (value === "") {
      throw new Error(
        `${name} must be set. GitHub Actions and .github/workflows/alchemy.yml set it.`,
      );
    }
    return value;
  };
  const apiUrl = required("GITHUB_API_URL");
  const repository = required("GITHUB_REPOSITORY");
  const owner = required("GITHUB_REPOSITORY_OWNER");
  const token = required("GITHUB_TOKEN");
  const branch = required("PREVIEW_BRANCH");
  const previewUrl = required("PREVIEW_URL");
  const convexUrl = required("VITE_CONVEX_URL");
  const sha = required("GITHUB_SHA");

  const request = async (path: string, init: { method?: string; body?: string } = {}) => {
    const response = await fetchGitHub(`${apiUrl}/repos/${repository}${path}`, {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub answered ${response.status} to ${init.method ?? "GET"} ${path}.`);
    }
    const body: unknown = await response.json();
    return body;
  };

  const pullRequests = Schema.decodeUnknownSync(PullRequests)(
    await request(`/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`),
  );
  const pullRequest = pullRequests
    .map(({ number }) => number)
    .toSorted((left, right) => left - right)
    .at(0);
  if (pullRequest === undefined) {
    console.log(`No pull request from ${JSON.stringify(branch)} is open. No comment.`);
    return undefined;
  }

  const body = `${marker}
**Preview:** ${previewUrl}

Convex: ${convexUrl}

Built from commit ${sha.slice(0, 7)}. This comment is updated on each push.`;
  // GitHub lists the comments oldest first, 100 per page. A page with fewer
  // than 100 comments is the last one.
  let existing: (typeof Comments.Type)[number] | undefined;
  for (let page = 1; existing === undefined; page += 1) {
    const comments = Schema.decodeUnknownSync(Comments)(
      await request(`/issues/${pullRequest}/comments?per_page=100&page=${page}`),
    );
    existing = comments.find(
      (comment) =>
        comment.user?.login === "github-actions[bot]" && comment.body?.startsWith(marker) === true,
    );
    if (comments.length < 100) {
      break;
    }
  }
  if (existing === undefined) {
    await request(`/issues/${pullRequest}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
  } else {
    await request(`/issues/comments/${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify({ body }),
    });
  }
  console.log(`Preview comment on pull request #${pullRequest}.`);
  return pullRequest;
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  await commentPreview(process.env);
}
