# Releasing

Releases are fully automated on the `dev` branch by
[release-please](https://github.com/googleapis/release-please) (`.github/workflows/release.yml`).
None of the files involved (`release-please-config.json`, `.release-please-manifest.json`,
`CHANGELOG.md`, `version.txt`, `.github/`) exist upstream in `getwud/wud`, so this machinery is
fork-only and never conflicts with upstream merges.

## How it works

1. Every push to `dev` updates an open `chore: release X.Y.Z` PR whose version is derived from
   [Conventional Commit](https://www.conventionalcommits.org/) messages since the last release:
   `fix:` → patch, `feat:` → minor, `feat!:` / `BREAKING CHANGE:` footer → major.
2. The release PR auto-merges (squash) once CI passes.
3. Merging it tags `vX.Y.Z`, publishes a GitHub release with the changelog, and builds
   `ghcr.io/avargaskun/wud` with tags `X.Y.Z`, `X.Y`, `X`, and `latest`, passing the version as the
   `WUD_VERSION` build arg.

Pushes to `dev` also continue to publish the moving `:dev` tag (`ci-push.yml`), stamped with
`WUD_VERSION=dev-<short-sha>`.

## Overrides

- Force a specific version: add a `Release-As: X.Y.Z` footer to a commit landing on `dev`.
- Re-publish an existing tag's image: run the Release workflow manually via `workflow_dispatch`
  with the `tag` input.

Versioning starts at `v9.0.0`, a major bump over upstream's `8.3.1` (`bootstrap-sha` in
`release-please-config.json` marks where fork history scanning begins).
