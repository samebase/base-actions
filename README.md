# Samebase app

This repository is the starter app that Samebase copies into a new GitHub repository.

It is a small, complete app base. It includes working authentication, real-time data, sharing, and
deployment paths without adding product-specific services that a new app might not need.

This README covers work inside the repository and the deploy setup.

## Stack

- React 19 and TanStack Start in SPA mode
- Convex for the real-time backend, database, and guest authentication
- A Cloudflare Worker (the TanStack Start server entry plus static assets), deployed by Alchemy
  from GitHub Actions
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

| Command          | Purpose                                                        |
| ---------------- | -------------------------------------------------------------- |
| `pnpm run check` | Format, lint, type-check, test, and verify generated redirects |
| `pnpm run build` | Run the check, then a local app build                          |

## Deployment contract

`alchemy.run.ts` is the only deploy path. `alchemy deploy` pushes the Convex functions, then builds
the app with Vite and uploads the Worker. `.github/workflows/alchemy.yml` runs it:

| Event                                  | Stage         | What it deploys                                                                              |
| -------------------------------------- | ------------- | -------------------------------------------------------------------------------------------- |
| Push to `main`                         | `prod`        | Convex project and production deployment, Worker                                             |
| Pull request opened, updated, reopened | `pr-<number>` | Convex preview deployment named after the branch, Worker Preview of the prod Worker, comment |
| Pull request closed                    | `pr-<number>` | `alchemy destroy`: deletes the preview deployment and the Worker Preview                     |

Each job installs the dependencies without lifecycle scripts and runs the supply-chain audits of
`.github/workflows/ci.yml` first. Only the deploy or destroy step gets the credentials. The deploy
job also runs `pnpm run check` before the deploy.

A pull request deploys as the stage `pr-<number>`, and the Worker Preview takes that name. The Convex
preview deployment gets the branch name itself, the name `npx convex deploy --preview-name` gives
it. `pr-<number>` and the Worker name must fit together in one 63-character DNS label. A pull
request number that is too long for the Worker name stops the deploy; use a shorter repository name.

The Worker and the Convex project take the repository name: lowercase, every run of other
characters as one dash. The Alchemy stack takes the owner and the repository, lowercase, joined with
`_` (`my-org/my-app` becomes `my-org_my-app`), so two repositories never share Alchemy state.

The deploy never takes over a Worker or a Convex project that it did not create. If the Cloudflare
account already has a Worker with the same name that this stack did not create, or the Convex team
already has a project with the same name that is not in this stack's state, the deploy stops with
`OwnedBySomeoneElse`. The workflow does not pass `--adopt`.

The stack makes the Convex Auth keys: `JWT_PRIVATE_KEY` and `JWKS` on the production deployment,
and the same two variables as project defaults for preview and dev deployments. The Convex project
is kept when the stack is destroyed.

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
`CONVEX_ACCESS_TOKEN`. Then run:

```sh
pnpm exec alchemy deploy --stage prod
```

## Important files

- `package.json` defines the supported development, check, and build commands.
- `prerender.config.ts` defines the public pages shared by TanStack Start and Cloudflare.
- `vite.config.ts` defines the TanStack Start SPA and prerender behavior.
- `alchemy.run.ts` defines the Convex and Cloudflare resources of each stage: static asset routing,
  SPA fallback, Worker Previews, and the Convex Auth keys.
- `.github/workflows/alchemy.yml` deploys and destroys the stages.
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
