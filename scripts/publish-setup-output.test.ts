import { describe, expect, it } from "vite-plus/test";

import { readSetupOutput } from "./publish-setup-output.ts";

// The three log lines are what `alchemy state read --backend cloudflare
// <stack>/prod/output` printed before the JSON in GitHub Actions on
// 2026-10-06 (alchemy 2.0.0-beta.80). The stack output after them is this
// template's.
const logLines = `[21:10:43.462] INFO (#1): Cloudflare: using environment variables (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN) instead of the profile.
• Refreshing Cloudflare State Store credentials
✓ Refreshing Cloudflare State Store credentials
`;

const samebase = {
  version: 1,
  state: "deployed",
  cloudflare: {
    accountId: "0123456789abcdef0123456789abcdef",
    workers: [{ tag: "7c1f0e0d2b8a4c5e9f1a2b3c4d5e6f70", name: "my-app", rootDirectory: "/" }],
  },
  convex: { teamId: "12345", projects: [{ projectId: "678901", convexConfigPath: "convex.json" }] },
};

const printed = (stackOutput: unknown) => `${logLines}${JSON.stringify(stackOutput, null, 2)}\n`;

describe("readSetupOutput", () => {
  it("reads the samebase value after the log lines and leaves the other outputs out", () => {
    expect(
      readSetupOutput(
        printed({
          workerUrl: "https://my-app.example.workers.dev",
          convexUrl: "https://happy-otter-123.convex.cloud",
          samebase,
        }),
      ),
    ).toEqual(samebase);
  });

  // The Workers, roots, and code locations of the shared-convex-monorepo-fixture in
  // apps/samebase/src/repository/dashboard/RepositoryOverviewDialogsVisualFixture.tsx.
  it("reads several Workers and Convex projects, as a monorepo stack lists them", () => {
    const monorepo = {
      ...samebase,
      cloudflare: {
        ...samebase.cloudflare,
        workers: [
          {
            tag: "admin-worker-tag",
            name: "shared-convex-monorepo-fixture-admin",
            rootDirectory: "apps/admin",
          },
          {
            tag: "portal-worker-tag",
            name: "shared-convex-monorepo-fixture-portal",
            rootDirectory: "apps/portal",
          },
          {
            tag: "web-worker-tag",
            name: "shared-convex-monorepo-fixture-web",
            rootDirectory: "apps/web",
          },
        ],
      },
      convex: {
        ...samebase.convex,
        projects: [
          { projectId: "678901", convexConfigPath: "apps/portal/convex.json" },
          { projectId: "678902", convexDirectoryPath: "packages/backend/convex" },
        ],
      },
    };
    expect(readSetupOutput(printed({ samebase: monorepo }))).toEqual(monorepo);
  });

  it("fails without a stack output, as after a deploy with --include", () => {
    expect(() => readSetupOutput(`${logLines}undefined\n`)).toThrow("printed no stack output");
  });

  it("fails without a samebase value", () => {
    expect(() =>
      readSetupOutput(printed({ workerUrl: "https://my-app.example.workers.dev" })),
    ).toThrow();
  });

  it("fails on a section, a kind, or a field that version 1 does not define", () => {
    expect(() => readSetupOutput(printed({ samebase: { ...samebase, deployKey: "x" } }))).toThrow();
    expect(() =>
      readSetupOutput(printed({ samebase: { ...samebase, email: { zones: ["example.com"] } } })),
    ).toThrow();
    expect(() =>
      readSetupOutput(
        printed({ samebase: { ...samebase, cloudflare: { ...samebase.cloudflare, buckets: [] } } }),
      ),
    ).toThrow();
    expect(() =>
      readSetupOutput(
        printed({
          samebase: { ...samebase, convex: { ...samebase.convex, region: "aws-us-east-1" } },
        }),
      ),
    ).toThrow();
  });

  it("fails on a project that names both a convex.json and a convex/ directory", () => {
    expect(() =>
      readSetupOutput(
        printed({
          samebase: {
            ...samebase,
            convex: {
              ...samebase.convex,
              projects: [
                {
                  projectId: "678901",
                  convexConfigPath: "convex.json",
                  convexDirectoryPath: "convex",
                },
              ],
            },
          },
        }),
      ),
    ).toThrow();
  });

  it("fails on numeric Convex ids and on empty lists", () => {
    expect(() =>
      readSetupOutput(
        printed({ samebase: { ...samebase, convex: { ...samebase.convex, teamId: 12345 } } }),
      ),
    ).toThrow();
    expect(() =>
      readSetupOutput(
        printed({ samebase: { ...samebase, cloudflare: { ...samebase.cloudflare, workers: [] } } }),
      ),
    ).toThrow();
  });

  it("fails on another version, on the destroy receipt, and on the failed output", () => {
    expect(() => readSetupOutput(printed({ samebase: { ...samebase, version: 2 } }))).toThrow();
    expect(() =>
      readSetupOutput(printed({ samebase: { version: 1, state: "destroyed" } })),
    ).toThrow();
    expect(() => readSetupOutput(printed({ samebase: { version: 1, state: "failed" } }))).toThrow();
  });
});
