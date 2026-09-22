# CV container delivery

## Current work package

State: CONVERGING. The Human authorized the main/develop workflow and the
bounded source changes below. Implementation validation does not claim Human
acceptance of the complete deployment.

- Goal: use `develop` for routine commit-and-push development and a
  `develop` → `main` Promotion PR for release. Preserve GitHub Pages and the
  root-site container target, document loopback-only live-edit preview, and
  adapt production Compose to the deployment owner's external `npm_net`.
- Exclusions: redesign, resume edits, Portainer administration, automatic
  production redeployment, hosted development preview, DNS/Authentik/TLS
  changes, digest-promotion automation, and WordPress changes.
- Validation: scoped workflow/Compose/rule checks, loopback binding and a real
  edit/restore preview check, plus the existing dual-target container CI on
  `develop`. Previous build/PDF evidence remains applicable to unchanged source;
  CI runs its existing commands, including isolated container HTTP checks.
- Delivery endpoint: pushed `develop`, one draft `develop` → `main` Promotion
  PR replacing the old topic release candidate, and CI evidence. No main merge,
  GHCR publication, deployment or parent-workspace gitlink change in this task.

## Branches and local development

`Personal-Presentations` is a manifest/assets parent and stays main-only. This
CV child repository owns `develop` and `main`; do not add a parent `develop`
branch or change its gitlink as a side effect of CV development.

- Make routine, coherent changes on `develop`, commit the scoped changes and
  push immediately. No topic branch or PR is required for each small edit.
- Keep one Promotion PR from `develop` to `main` for the next public release.
  Further develop commits update that PR. Human release authorization is
  separate from committing/pushing development work.
- `main` owns GitHub Pages and production image publication. No workflow on
  `develop` publishes a public site or production image, even when dispatched
  manually. Public `arfiligol.tw` uses a main-built image selected by the
  deployment owner; merging does not itself update Portainer yet.
- Preserve Human WIP: do not switch a dirty checkout, reset, stash or include
  unrelated files automatically. Use the existing clean develop worktree or
  create a separate worktree when needed. Before ordinary work in a clean
  checkout: `git switch develop`, then `git pull --ff-only origin develop`.

For live editing at the root URL, run in the **develop worktree**:

```sh
pnpm install --frozen-lockfile
SITE_URL=https://arfiligol.tw BASE_PATH=/ pnpm dev
```

Open `http://127.0.0.1:4321/` (or the local port Astro prints). The existing
`dev` script binds to `127.0.0.1`; saving source edits updates the preview.
Do not use `--host 0.0.0.0`, LAN binding, a public tunnel, or a hosted preview
for this local workflow. `pnpm dev` without environment overrides instead
previews the Pages base path at `http://127.0.0.1:4321/I-LI_CHIU_CV/`.

Built-artifact preview is different:

```sh
SITE_URL=https://arfiligol.tw BASE_PATH=/ pnpm build
SITE_URL=https://arfiligol.tw BASE_PATH=/ pnpm pdf
pnpm pdf:typst
SITE_URL=https://arfiligol.tw BASE_PATH=/ pnpm preview
```

`preview` serves the existing `dist/` on loopback; it does not rebuild after
source edits. PDF commands create downloadable files and are not live-preview
servers. Stop any dev/preview process using port 4321 before PDF generation, or
set `PREVIEW_PORT` to a free port for `pnpm pdf`. Keep build and PDF target
variables consistent. The live editor alone does not create PDF downloads.

## Build targets and ownership

The default build remains GitHub Pages (`https://arfiligol.github.io`, base
`/I-LI_CHIU_CV`). Container CI sets `SITE_URL=https://arfiligol.tw` and
`BASE_PATH=/` for both Astro build and Playwright PDF generation. These are
**build-time** values: setting them on an already built container does not
rewrite its links or canonical URLs.

Git owns source, Dockerfile, Compose and CI. GitHub Actions produces `dist/`
and publishes it to GHCR. nginx serves only the generated site, with no Node
server, WordPress database or persistent site volume. Portainer owns runtime
environment values and registry credentials; never commit credentials.

`.github/workflows/pages.yml` has explicit main-only job conditions, including
manual dispatch. `container.yml` validates both targets on develop/main pushes
and Promotion PRs to main. Develop and pull requests never publish.
On `main`, after validation, CI publishes `ghcr.io/arfiligol/i-li-chiu-cv`
with `sha-<full commit SHA>` and `latest` tags, and records the image digest in
the run summary. Use that digest for a repeatable deployment or rollback;
tags (including SHA-named tags on a rerun) can be republished.

The image index includes Linux amd64 and arm64. Runtime HTTP validation runs
on amd64 only; this is not a claim of testing the target Portainer host.

## GitHub setup

1. When a public release is authorized, review and merge the develop-to-main
   Promotion PR. Open **Actions → Build CV container**
   and check that both validation jobs and publication succeed.
2. No Docker Hub account, long-lived push token, or Portainer Secret is needed
   for this phase. CI uses the repository's automatic `GITHUB_TOKEN`, with
   `packages: write` limited to the publication job.
3. If repository/organization Actions policy blocks an action or package
   publication, allow the referenced actions and this repository's package
   write access. Do not globally broaden permissions as a first workaround.
4. Open the GitHub profile's **Packages → i-li-chiu-cv → Package settings**.
   A new GHCR package may be private even for a public source repository.
   Keep it private and configure authenticated pulls in Portainer, or explicitly
   choose Public if you want anonymous pulls. CI does not change visibility.
5. For private pulls, add a GHCR registry in Portainer with your GitHub username
   and a personal access token (classic) with `read:packages`. Keep the token
   in Portainer, not Compose, Git, screenshots, or chat. Use the narrowest
   account access available and authorize SSO if applicable.

## First Portainer deployment (operator-run)

The deployment owner reported Docker Standalone, Portainer BE 2.45.1, Nginx
Proxy Manager (NPM), and an existing shared external network `npm_net`.
WordPress was reported stopped with its data preserved. These are operator
handoff facts, not infrastructure checks performed by this source task. The
deployment owner must check that the alias `i-li-chiu-cv` is not already used
on `npm_net` before deploying; source work does not inspect or change the host.

1. In the intended Docker Standalone environment, open **Stacks → Add stack →
   Git repository**. Name the new stack `i-li-chiu-cv`.
2. Select/create the source `https://github.com/arfiligol/I-LI_CHIU_CV.git`,
   reference `refs/heads/main`, Compose path `compose.yaml`. This source repo
   is public. Git credentials and GHCR pull credentials are separate.
3. Add environment variables:
   - `CV_IMAGE`: the complete `ghcr.io/arfiligol/i-li-chiu-cv@sha256:...` value
     from the successful publication summary. It is required, with no implicit
     `latest` fallback.
4. Select the authenticated GHCR registry if the package is private. Leave
   **GitOps updates off** for this first deployment. Deploy the stack.
5. Production Compose publishes **no host ports**. Both NPM and the CV must
   attach to `npm_net`; Compose will fail if this external network is absent.
   NPM's upstream is scheme `http`, hostname `i-li-chiu-cv`, port `80`.
   The alias is private container DNS, not a public DNS record. Do not add a
   host-port mapping or point NPM at its own localhost.
6. Check both languages, styles and the four PDF downloads. The configured
   production site URL remains `arfiligol.tw` during this isolated check.

This Compose file is for Docker Standalone, not Swarm. CI checks the Compose
syntax but runs its smoke container separately on an ephemeral CI-only
loopback port. It never requires or creates the production `npm_net` network.
NPM public routing/TLS and DNS remain deployment-owner/Human operations.

## Updates, rollback, and later GitOps

For this phase, copy a new successful image digest into `CV_IMAGE` in Portainer
and redeploy. Roll back by restoring the previous digest and redeploying; retain
previous images. Keep the current WordPress stack and data intact until the
separate domain migration is verified.

Image publication is CI delivery, not proof that Portainer deployed it. Merely
enabling Git polling will not update the digest stored in `CV_IMAGE`. Do not
turn on polling against a mutable `latest` tag before CI has finished building.

The later GitOps setup must connect successful image publication to the desired
deployment revision. Choose the supported mechanism after checking the actual
Portainer version/edition: for example, a Git-tracked digest manifest updated
only after publication, or a CI-triggered webhook with explicit image selection.
No webhook is called or secret required by this workflow. Do not expose the
Portainer admin interface solely to make a webhook reachable.

Before switching `arfiligol.tw`, back up WordPress files/database, record its
current proxy route and rollback procedure, then configure TLS and the CV
upstream. DNS may not need to change if the same reverse proxy serves the site.

## References

- [GHCR authentication and visibility](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [Publishing images with GitHub Actions](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)
- [Portainer Git stacks](https://docs.portainer.io/user/docker/stacks/add)
