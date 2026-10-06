import { describe, expect, it } from "vite-plus/test";

import { deployNames } from "./deploy-names.ts";

describe("deployNames", () => {
  it("names the stack after the owner and the repository, and the resources after the repository", () => {
    expect(deployNames("My-Org/My_App.v2")).toEqual({
      repository: { owner: "My-Org", name: "My_App.v2" },
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
