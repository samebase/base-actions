import { describe, expect, it } from "vite-plus/test";

import { deployNames, workerPreviewName } from "./deploy-names.ts";

const worker54 = "a".repeat(54);

describe("deployNames", () => {
  it("names the stack after the owner and the repository, and the resources after the repository", () => {
    expect(deployNames("My-Org/My_App.v2")).toEqual({
      stack: "my-org_my_app.v2",
      worker: "my-app-v2",
      convexProject: "my-app-v2",
    });
  });

  it("cuts the Worker name to 54 characters and the Convex project to 40", () => {
    const names = deployNames(`my-org/${"a".repeat(39)}-${"b".repeat(30)}`);
    expect(names.worker).toBe(`${"a".repeat(39)}-${"b".repeat(14)}`);
    expect(names.convexProject).toBe("a".repeat(39));
  });

  it("fails without an owner and a repository", () => {
    expect(() => deployNames("")).toThrow('not "<owner>/<repository>"');
    expect(() => deployNames("my-org/___")).toThrow("has no letter or digit");
  });
});

describe("workerPreviewName", () => {
  it("adds a hash of the stage to the stage when it fits", () => {
    expect(workerPreviewName("feature-foo-bar-c86457cc23da70e8", "my-app")).toBe(
      "feature-foo-bar-c86457cc23da70e8-c96d28",
    );
  });

  it("cuts the stage to fit next to a long Worker name", () => {
    expect(workerPreviewName("feature-foo-bar-c86457cc23da70e8", "a".repeat(47))).toBe(
      "feature-c96d28",
    );
    expect(workerPreviewName("feature-foo-bar-c86457cc23da70e8", worker54)).toBe("f-c96d28");
  });

  it("starts with p when the stage starts with a digit", () => {
    expect(workerPreviewName("123-fix-6af8417c3c870528", "my-app")).toBe(
      "p123-fix-6af8417c3c870528-5e05e2",
    );
    expect(workerPreviewName("123-fix-6af8417c3c870528", worker54)).toBe("p-5e05e2");
  });

  it("fails closed on a name Cloudflare would refuse", () => {
    expect(() => workerPreviewName("Foo_Bar", "my-app")).toThrow("characters other than");
    expect(() => workerPreviewName("feature", "a".repeat(56))).toThrow("needs 8");
  });
});
