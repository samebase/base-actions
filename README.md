# Samebase app

This repository is the starter app that Samebase copies into a new GitHub repository.

It is a small, complete app base. It includes working authentication, real-time data, sharing, and
deployment paths without adding product-specific services that a new app might not need.

This README covers work inside the repository and the [setup stack](#setup-stack) that sets up the
providers.

## Stack

- React 19 and TanStack Start in SPA mode
- Convex for the real-time backend, database, and guest authentication
- Cloudflare Workers Static Assets for delivery
- Alchemy for the Cloudflare and Convex setup
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

| Command                                    | Purpose                                                        |
| ------------------------------------------ | -------------------------------------------------------------- |
| `pnpm run check`                           | Format, lint, type-check, test, and verify generated redirects |
| `pnpm run build`                           | Run the complete Cloudflare build path                         |
| `pnpm run deploy:dry-run --name my-worker` | Build and validate a production upload without publishing it   |

## Deployment contract

Cloudflare Workers Builds runs `pnpm run build` for all branches. It then uses:

| Branch type    | Deploy command            | Builds settings | `CONVEX_DEPLOY_KEY` value  |
| -------------- | ------------------------- | --------------- | -------------------------- |
| `main`         | `pnpm run deploy`         | Production      | Production deploy key      |
| Other branches | `pnpm run deploy:preview` | Previews Base   | Project Preview deploy key |

`build`, `deploy`, and `deploy:preview` are the package-script interface used by Samebase. Keep these
names when changing their implementation. Cloudflare supplies the appropriate build secrets for each
environment. Convex rejects a production key on a preview branch.

`scripts/build-cloudflare.ts` deploys Convex only inside Workers Builds and uses `WORKERS_CI_BRANCH`
as the stable preview name. Local builds only build the frontend.
`scripts/verify-current-branch-head.ts` prevents an older concurrent
build from deploying backend code after a newer commit reaches the same branch. `convex deploy
--cmd` supplies `VITE_CONVEX_URL` to the frontend build, so it is not a Cloudflare build variable.

The [setup stack](#setup-stack) sets up the providers.

## Setup stack

`alchemy.run.ts` declares the setup around the Worker: the Worker shell, the Workers Builds link
with its commands and build variables, the Convex project, and the two Convex deploy keys of the
builds. It never uploads code; `wrangler.jsonc` owns the Worker version. The split follows the
Samebase research note "Alchemy setup stacks next to Workers Builds"
(`research/2026-10-05-alchemy-setup-stack-and-wrangler-split.md` in the Samebase repository).

`.github/workflows/alchemy.yml` runs it on its one stage, `prod`:

| Event                                 | Run                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------- |
| Pull request that changes the stack   | `alchemy plan` and `alchemy drift`, read-only                                               |
| Push to `main` that changes the stack | `alchemy deploy --detect-drift`, which also repairs drift                                   |
| Run workflow on the default branch    | The same deploy. With `adopt`, it takes over resources that exist but are not in the state. |

The deploy that creates the Workers Builds link also starts the first production build: Samebase
pushes the starter to `main` before the link exists, so that push builds nothing. Later pushes start
their own builds.

After each deploy, the workflow uploads the artifact `samebase-setup-output`: the ids of the Workers
and the Convex projects that the stack owns. Samebase reads the newest one from the runs on the
default branch, checks each id with Cloudflare and Convex, and attaches the Workers and projects to
the app. It applies the first one by itself only when it names the Worker and the Convex project
that Samebase reserved when it created the app, both created after the app. Another first output,
and a later output that adds, drops, or replaces a Worker or a Convex project, waits for **Apply
setup output** on the app's overview in Samebase. Samebase never changes or deletes what the stack
owns. The [Destroy app](#destroy-the-app) workflow uploads a receipt under the same name after a
destroy, which Samebase shows as that run's report. `scripts/setup-output.ts` defines the file:

- One section per provider, each with its destination (the Cloudflare account, the Convex team) and
  one list per kind of resource. A stack with several Workers or Convex projects lists them all.
- A new kind of resource, such as buckets or email routing, is a new list or section and a new
  `version`. The current version rejects anything it does not define, so the deploy fails before
  the upload rather than publish something Samebase cannot read.
- It never holds a secret: anyone who can read the repository can download it.

The deploy never takes over a Worker or a Convex project with the same name that is not in the
stack's state; it stops with `OwnedBySomeoneElse`. Run the workflow with `adopt` to take them over.
The state is in Alchemy's state store in the Cloudflare account, which the first deploy in an
account creates.

| Resource       | Name                                                 | Example for `my-org/my-app` |
| -------------- | ---------------------------------------------------- | --------------------------- |
| Alchemy stack  | `<owner>_<repository>`, lowercase                    | `my-org_my-app`             |
| Worker         | The repository name made safe, at most 54 characters | `my-app`                    |
| Convex project | The repository name made safe, at most 40 characters | `my-app`                    |

Made safe means lowercase, every run of characters other than `a-z` and `0-9` as one dash, and no
dash at either end. `wrangler.jsonc` has no `name`: Workers Builds deploys to the Worker it is
connected to.

### Prerequisites

Install the Cloudflare Workers and Pages GitHub App on the owner of the repository, with access to
the repository, from **Workers & Pages** in the Cloudflare dashboard. Then set these in the GitHub
repository under **Settings > Secrets and variables > Actions**:

| Name                    | Kind     | Value                                                |
| ----------------------- | -------- | ---------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Secret   | A Cloudflare user API token for the account          |
| `CLOUDFLARE_ACCOUNT_ID` | Secret   | The Cloudflare account id                            |
| `CONVEX_ACCESS_TOKEN`   | Secret   | A Convex team access token                           |
| `CONVEX_TEAM_ID`        | Variable | The numeric id of the Convex team of that same token |

The Cloudflare token needs Account Settings Read, Workers Scripts Edit, Workers Builds Configuration
Edit, and Secrets Store Edit. When the account has no Workers Builds build token yet, the stack
registers this token as one, and Workers Builds deploys with it.

### Destroy the app

Open **Actions** in the GitHub repository, select the **Destroy app** workflow
(`.github/workflows/destroy.yml`), choose **Run workflow** on the default branch, and type
`delete <owner>/<repository>` in the `confirm` field. The run deletes the Workers Builds link, the
Convex deploy keys, the Worker with its Previews, the Convex project with every deployment and its
data, and the stack's state. Any other text, another branch, or a repository without the
`CONVEX_TEAM_ID` variable fails the run before it deletes anything, and the error says what to
change. The repository stays. Deleting the GitHub repository also deletes this workflow, so run it
first.

### Deploy from a laptop

Put the same four values and `GITHUB_REPOSITORY` (`<owner>/<repository>`) in `.env`, and
`GITHUB_TOKEN` for a private repository. The Convex CLI login (`npx convex login`) can replace
`CONVEX_ACCESS_TOKEN`.

```sh
pnpm exec alchemy deploy --stage prod
```

## Important files

- `package.json` defines the supported development, check, build, and deploy commands.
- `prerender.config.ts` defines the public pages shared by TanStack Start and Cloudflare.
- `vite.config.ts` defines the TanStack Start SPA and prerender behavior.
- `wrangler.jsonc` defines Cloudflare static assets, SPA fallback, and preview URLs.
- `scripts/build-cloudflare.ts` owns the Cloudflare build and Convex deployment selection.
- The `deploy` and `deploy:preview` package scripts run Wrangler directly.
- `convex/` contains the backend, schema, authentication, and generated Convex bindings.
- `src/` contains the React application and routes.
- `alchemy.run.ts` and `.github/workflows/alchemy.yml` define and run the setup stack.
- `.github/workflows/destroy.yml` destroys the app.
- `scripts/setup-output.ts` defines what the setup stack tells Samebase.

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
