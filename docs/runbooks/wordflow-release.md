# Wordflow Release Runbook

## Version Contract

Six stamped surfaces must agree: root and backend Python metadata, frontend
package metadata, Tauri Cargo metadata, the local Tauri Cargo lock entry, and
Tauri bundle configuration. `scripts/version-targets.mjs` is their sole
registry.

```bash
pnpm bump-version <semver>
pnpm check-versions
```

Run the version bump before building the frontend because the version is baked
into the bundle. The generated backend SPA archive and extracted build are
ignored; workflows recreate them with `pnpm deploy_frontend_to_backend`.

## Continuous Integration

Root `.github/workflows/ci.yml` validates frontend and backend source together
on every push and pull request. Backend jobs run on Linux, macOS, and Windows
and use normal locked `uv sync`, so `[tool.uv.sources]` determines whether a
dependency comes from a checked-out sibling or a registry.

Before release, publish any supporting-package version required by backend
metadata. Source-aware CI can succeed while release validation correctly fails
because an unpublished registry dependency is unavailable.

## Publish the Python Package

The root `pypi-release.yml` publishes `ldaca-wordflow`; the backend remains a
separately installable Python distribution even though its source is tracked in
the monorepo.

1. Bump and review the shared version and release notes.
2. Run `pnpm check-versions` and require root CI to pass on the release commit.
3. Confirm every declared registry dependency is published for all supported
   platforms.
4. Create and push the exact root tag `v<semver>`.
5. Manually dispatch `Backend Package Release` at that tag with the `pypi`
   publish target.

```bash
gh workflow run pypi-release.yml --ref v<semver> -f publish_target=pypi
```

The manually dispatched workflow does not repeat Ruff, Ty, pytest, or frontend
CI. It checks tag/version identity, builds and stages the SPA, runs
`uv build --no-sources`, validates metadata and wheel contents, installs the
exact wheel with `--no-sources` in a clean environment, and publishes that
artifact to PyPI. Any missing registry dependency stops the workflow before
upload. Do not normally reuse a published package version.

Manual dispatch can build without publication or select TestPyPI. Production
PyPI publication requires both the `pypi` target and a `vX.Y.Z` tag ref.

PyPI trusted publishing must identify:

- owner: `Australian-Text-Analytics-Platform`
- repository: `ldaca-wordflow`
- workflow: `pypi-release.yml`
- environment: none

Keep the old standalone-repository publisher only until the first successful
root-origin release, then remove it.

## Publish Desktop Artifacts

Desktop publication is deliberately manual and independent of PyPI. Dispatch
`Manual Desktop Release` (`desktop-release.yml`) at the exact tag or commit.
Leave **Publish artifacts** disabled for non-publishing acceptance builds. To
publish, enable it and supply the existing `vX.Y.Z` tag.

The workflow invokes the reusable Windows and macOS desktop builds, downloads
their exact artifacts, constructs `latest.json`, and publishes the MSI, DMG,
updater archives, and signatures without rebuilding. Its backend runtime uses
normal source-aware locked sync; it does not require the Python package to have
already reached PyPI.

## Post-release

- Install the exact backend version with `uvx --from ldaca-wordflow==<semver>
  ldaca-wordflow --help`.
- Confirm the MSI, DMG, both updater signatures, macOS updater archive, and
  `latest.json` exist in the GitHub Release. Confirm `latest.json.notes` exactly
  matches the GitHub Release body.
- Install an older signed build on macOS and Windows. Verify a manual no-update
  result, available-version metadata and rendered notes, singleton window
  focusing, determinate download progress, and the indeterminate state when a
  content length is unavailable.
- Verify **Skip this version** suppresses that exact version only for automatic
  checks, **Decide later** dismisses without skipping, and manual checks still
  show a skipped release. Confirm automatic checking occurs at most once in 24
  hours and the desktop General setting can disable and re-enable it.
- Download the signed update, choose **Restart and install**, and confirm macOS
  relaunches into the new version and Windows exits into the passive installer.
  Confirm closing the updater window never stops the backend and closure is
  prevented while download or installation is active.
- Deploy the tagged root commit and current supporting-package pointers.
- Verify `/health/live`, `/health/ready`, hosted login, one Workspace read, and `/api/events`
  delivery.
