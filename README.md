# Samebase app

This repository is the starter app that Samebase copies into a new GitHub repository.

It is a small, complete app base. It includes working authentication, real-time data, sharing, and
deployment paths without adding product-specific services that a new app might not need.

This README covers work inside the repository and the deploy setup.

## Stack

- React 19 and TanStack Start in SPA mode
- Convex for the real-time backend, database, and guest authentication
- A Cloudflare Worker that serves the static assets, defined in `cloudflare.config.ts` and uploaded
  by `cf` from GitHub Actions, with an Alchemy setup stack for the Worker shell and the Convex side
- shadcn/ui primitives for the user interface
- Vite+ for development, formatting, linting, tests, and builds
- Node.js 24 for application and automation code

The example app is a public todo list. Guests can sign in without an external identity provider,
create todos, see real-time updates, and scan a QR code to open the same list on another device.

## Local development

Install [Vite+](https://viteplus.dev/guide/) and use it to supply the Node.js version in
`.node-version`. Run `corepack enable` once to make the pinned pnpm version available.

```sh
corepack enable
pnpm install
pnpm run dev
```

The development command starts Convex and TanStack Start together. It also creates missing Convex
Auth JWT keys in the development deployment. In a linked Git worktree, the same command
automatically uses an isolated local backend. Convex writes `VITE_CONVEX_URL` to `.env.local`; do
not set it manually.

To force the isolated backend outside a linked worktree, use:

```sh
pnpm run dev:worktree
```

The core workflow runs on macOS, Linux, and Windows. See
[`docs/local-setup.md`](./docs/local-setup.md) for the local Convex setup and troubleshooting steps.

## Checks and builds

| Command          | Purpose                                                                         |
| ---------------- | ------------------------------------------------------------------------------- |
| `pnpm run check` | Format, lint, type-check, test, and verify generated redirects                  |
| `pnpm run build` | Run the check, then the app build and the Worker Build Output in `.cloudflare/` |

The Worker build reads the Worker name from `GITHUB_REPOSITORY` (`<owner>/<repository>`), which
GitHub Actions sets. On a laptop, set it in the environment or in `.env`.

## Deployment contract

Each part of the deploy has one owner:

| File                            | Owns                                                                                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cloudflare.config.ts`          | The Worker: its name, the static assets with the SPA fallback, the compatibility date, and Preview URLs. `cf` uploads it.                             |
| `alchemy.run.ts`                | The setup stack: the Worker shell, the Convex project and deployments, the deploy keys, the Convex Auth keys, and the functions push. No Worker code. |
| `scripts/deploy-names.ts`       | The names of the stack, the Worker, the Convex project, and the Worker Previews.                                                                      |
| `.github/workflows/alchemy.yml` | The order of the steps for each branch.                                                                                                               |

The workflow runs for every branch, the way Cloudflare Workers Builds builds every branch:

| Event                      | Steps                                                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Push to the default branch | `alchemy deploy --stage prod`, the app build, `cf deploy --prebuilt`                                                                           |
| Push to any other branch   | `alchemy deploy --stage <stage>`, the Preview build, `cf previews deploy --prebuilt <Preview name>`, the comment on an open pull request       |
| Branch deleted             | `alchemy destroy --stage <stage>`, which deletes the Convex preview deployment, then `scripts/delete-worker-preview.ts` for the Worker Preview |

The stack outputs `convexUrl` on every stage and `workerUrl`, the `workers.dev` URL of the Worker, on
`prod`. After `alchemy deploy`, the workflow reads them with `alchemy state read` and builds the app
with `VITE_CONVEX_URL` set to `convexUrl`. The build step gets no credentials. It writes the Build
Output to `.cloudflare/output`, and `cf` uploads that output as it is. The default branch must
deploy once before the first preview: a preview uses the Convex project and the Worker of `prod`.

When a pull request from the branch is open, the job posts the Preview URL and the Convex URL as a
comment on it, and later pushes update that comment. A pull request opened after the last push gets
the comment on the next push. A pull request from a fork gets no preview.

The runs of one branch run one at a time, in order, so a branch delete waits for a running deploy.
Before the deploy, the job checks that its commit is still the head of the branch. A rerun of an
older push ends without a deploy. Before the destroy, the job checks that the branch is still
deleted. A rerun of a delete after the branch was pushed again ends without a destroy.

Both jobs run only when the repository variable `CONVEX_TEAM_ID` is set. A copy of the repository
without the deploy setup skips them.

Each job installs the dependencies without lifecycle scripts and runs `pnpm audit signatures` first.
The deploy job then runs the two vulnerability audits of `.github/workflows/ci.yml` and
`pnpm run check`. The destroy job does not, so a new advisory cannot block a cleanup. Each credential
goes only to the steps that need it.

The names, for the repository `my-org/my-app` and the branch `feature/Foo_bar`:

| Resource                  | Name                                                    | Example                                   |
| ------------------------- | ------------------------------------------------------- | ----------------------------------------- |
| Alchemy stack             | `<owner>_<repository>`, lowercase                       | `my-org_my-app`                           |
| Worker                    | The repository name made safe, at most 54 characters    | `my-app`                                  |
| Convex project            | The repository name made safe, at most 40 characters    | `my-app`                                  |
| Preview stage             | The branch made safe, at most 40 characters, and a hash | `feature-foo-bar-c86457cc23da70e8`        |
| Convex preview deployment | The branch                                              | `feature/Foo_bar`                         |
| Worker Preview            | The stage, cut to fit, and a hash                       | `feature-foo-bar-c86457cc23da70e8-c96d28` |

Made safe means lowercase, every run of characters other than `a-z` and `0-9` as one dash, and no
dash at either end.

Every preview stage ends with a dash and the first 16 hex characters of the SHA-256 of the branch,
so two branches never share a stage: `feature/Foo_bar` gets `feature-foo-bar-c86457cc23da70e8`, and
`feature-foo-bar` gets `feature-foo-bar-8c7b58b499c9cf55`. Only the default branch deploys as
`prod`.

Every Worker Preview name ends with a dash and the first 6 hex characters of the SHA-256 of the
stage. A Preview is served at `<name>-<worker>.<subdomain>.workers.dev`, so `<name>-<worker>` must
fit in a 63-character DNS label. The stage is cut to fit before the hash: next to a 47-character
Worker name, `feature-foo-bar-c86457cc23da70e8` becomes `feature-c96d28`. The name starts with `p`
when the stage starts with a digit.

In rare cases, the Preview names of two branches are the same, and a deploy of one branch then
replaces the Preview of the other. A long Worker name leaves less room for the name and makes this
more likely.

A branch without a letter or a digit, such as `///`, stops the deploy; rename the branch. Renaming
the repository is not supported by the deploy.

The deploy never takes over a Worker or a Convex project that it did not create. If the Cloudflare
account already has a Worker with the same name that this stack did not create, or the Convex team
already has a project with the same name that is not in this stack's state, the deploy stops with
`OwnedBySomeoneElse`. The workflow does not pass `--adopt`.

The stack makes the Convex Auth keys: `JWT_PRIVATE_KEY` and `JWKS` on the production deployment,
and the same two variables as project defaults for preview and dev deployments. The Worker and the
Convex project are kept when the stack is destroyed.

Alchemy keeps its state in a state store in the Cloudflare account, which every stack of the account
shares. With `--yes`, the first deploy in an account creates the store: a Worker named
`alchemy-state-store` with its keys in the account Secrets Store.

### Secrets and variables

Set these in the GitHub repository under **Settings > Secrets and variables > Actions**:

| Name                    | Kind     | Value                                                |
| ----------------------- | -------- | ---------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Secret   | A Cloudflare API token for the account               |
| `CLOUDFLARE_ACCOUNT_ID` | Secret   | The Cloudflare account id                            |
| `CONVEX_ACCESS_TOKEN`   | Secret   | A Convex team access token                           |
| `CONVEX_TEAM_ID`        | Variable | The numeric id of the Convex team of that same token |

GitHub Actions provides `GITHUB_TOKEN` and `GITHUB_REPOSITORY`.

### Deploy from a laptop

Put the same four values and `GITHUB_REPOSITORY` (`<owner>/<repository>`) in `.env`, or in the
environment, which takes precedence. The Convex CLI login (`npx convex login`) can replace
`CONVEX_ACCESS_TOKEN`. Deploy the stack, then build with `VITE_CONVEX_URL` set to the `convexUrl`
output that the deploy prints, and upload the Worker:

```sh
pnpm exec alchemy deploy --stage prod
pnpm run build:app
pnpm exec cf deploy --prebuilt
```

## Important files

- `package.json` defines the supported development, check, and build commands.
- `prerender.config.ts` defines the public pages shared by TanStack Start and Cloudflare.
- `vite.config.ts` defines the TanStack Start SPA and prerender behavior.
- `cloudflare.config.ts` defines the Worker: static asset routing and SPA fallback.
  `wrangler.config.ts` holds the build settings of the Wrangler bundler.
- `alchemy.run.ts` defines the setup stack of each stage: the Worker shell, the Convex side, and the
  Convex Auth keys.
- `.github/workflows/alchemy.yml` deploys and destroys the stages with the scripts in `scripts/`.
- `convex/` contains the backend, schema, authentication, and generated Convex bindings.
- `src/` contains the React application and routes.

## Generated and managed files

- `src/routeTree.gen.ts` is generated by TanStack Router.
- `convex/_generated/api.*`, `dataModel.d.ts`, and `server.*` are generated by Convex.
- `convex/_generated/ai/`, `.agents/skills/`, `skills-lock.json`, and the marked Convex sections in
  `AGENTS.md` and `CLAUDE.md` are managed by `npx convex ai-files install`.
- The marked Vite+ section in `AGENTS.md` is generated by `vp config`. The package `prepare`
  command uses `--no-agent`, so installs do not rewrite it.
- `scripts/generate-cloudflare-redirects.ts` owns only the marked generated block in
  `public/_redirects`. Custom redirect rules can stay outside that block.

Do not hand-edit generated files when their source tool can update them.
When a Convex AI-file update changes the installed source snapshot, confirm its distribution license
and update `THIRD_PARTY_NOTICES.md` when its third-party material changes.

## License

Licensed under the [Apache License 2.0](./LICENSE). See
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) for included third-party material.
