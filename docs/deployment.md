# CV container delivery

## Current work package

State: CONVERGING. This package adds container CI and operator instructions;
it does not accept the new deployment semantics on the Human's behalf.

- Goal: preserve GitHub Pages and build the same CV and four downloadable PDFs
  for `https://arfiligol.tw/`, packaged as a static nginx image in GHCR.
- Exclusions: redesign, resume edits, Portainer administration, automatic
  production redeployment, DNS/TLS changes, and WordPress removal.
- Validation: frozen dependency install; existing `pnpm check`, `pnpm build`,
  `pnpm pdf`, and `pnpm pdf:typst` for both URL targets; container build and
  basic HTTP checks on the CI runner; workflow/Compose syntax and diff checks.
- Delivery endpoint: a reviewable branch/PR with GitHub CI evidence. Publishing
  is enabled only on `main`; merging and the first live deployment are separate
  steps. No root-workspace submodule pin changes before child integration.

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

`.github/workflows/pages.yml` remains unchanged. `container.yml` validates
both targets on pull requests and main pushes. Pull requests never publish.
On `main`, after validation, CI publishes `ghcr.io/arfiligol/i-li-chiu-cv`
with `sha-<full commit SHA>` and `latest` tags, and records the image digest in
the run summary. Use that digest for a repeatable deployment or rollback;
tags (including SHA-named tags on a rerun) can be republished.

The image index includes Linux amd64 and arm64. Runtime HTTP validation runs
on amd64 only; this is not a claim of testing the target Portainer host.

## GitHub setup

1. Review and merge the container CI PR. Open **Actions → Build CV container**
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

Do not change the current WordPress stack, DNS, or reverse-proxy route yet.

1. In the intended Docker Standalone environment, open **Stacks → Add stack →
   Git repository**. Name the new stack `i-li-chiu-cv`.
2. Select/create the source `https://github.com/arfiligol/I-LI_CHIU_CV.git`,
   reference `refs/heads/main`, Compose path `compose.yaml`. This source repo
   is public. Git credentials and GHCR pull credentials are separate.
3. Add environment variables:
   - `CV_IMAGE`: the complete `ghcr.io/arfiligol/i-li-chiu-cv@sha256:...` value
     from the successful publication summary. It is required, with no implicit
     `latest` fallback.
   - `CV_BIND_ADDRESS`: defaults to `127.0.0.1` to avoid exposing an unprotected
     test port. If needed, choose the server's private LAN IP, with firewall
     access limited to your trusted network.
   - `CV_PORT`: defaults to `8088`; choose another unused port if necessary.
4. Select the authenticated GHCR registry if the package is private. Leave
   **GitOps updates off** for this first deployment. Deploy the stack.
5. Check the container is running/healthy. With the loopback default, view it
   from the host or use an SSH tunnel (`ssh -L 8088:127.0.0.1:8088 USER@HOST`),
   then open `http://127.0.0.1:8088/` on your own computer. Opening
   `SERVER_IP:8088` will not work with a loopback-only binding.
6. Check both languages, styles and the four PDF downloads. The configured
   production site URL remains `arfiligol.tw` during this isolated check.

This Compose file is for Docker Standalone, not Swarm. If the reverse proxy
is another container, its `127.0.0.1` is not the Docker host: configure an
appropriate shared network/upstream later rather than guessing one now.

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
