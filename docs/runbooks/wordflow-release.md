# Wordflow Release Runbook

## Version Contract

Six independently stamped surfaces must agree: root and backend Python
metadata, frontend package metadata, Tauri Cargo metadata, the local Tauri
Cargo lock entry, and Tauri bundle configuration. `scripts/version-targets.mjs`
is their sole registry.

```bash
pnpm bump-version <semver>
pnpm check-versions
pnpm deploy_frontend_to_backend
```

Run the version bump before building the frontend because the version is baked
into the bundle.

## Validate Source And Artifacts

```bash
cd backend
uv run ruff check .
uv run ty check
uv run pytest -q
uv build --no-sources
```

```bash
pnpm -C frontend check
```

Validate and publish supporting package versions before a backend release when
the backend metadata requires versions not yet on the package index. Source
mode uses uv path sources; release builds use `--no-sources` to prove published
metadata is sufficient.

## Publish

1. Commit the version, lock, bundled frontend, and release notes in each
   affected submodule/repository.
2. Push and tag `polars-source-utils` and `polars-text` when they changed.
3. Tag the backend package after its dependencies are available.
4. Update the root submodule pointers and version surfaces.
5. Run `pnpm check-versions` again from the final root commit.
6. Create and push the exact root tag `v<semver>`.

The root release workflow verifies version consistency and requires the release
tag to resolve to the checked-out commit. It then calls the shared desktop
workflow for Windows MSI and signed macOS artifacts. The release job publishes
those exact build outputs together with their updater signatures and generated
`latest.json`; it never rebuilds them. Do not hand-edit version strings or
normally reuse a published package version.

## Post-release

- Install the exact backend version with `uvx --from ldaca-wordflow==<semver>
  ldaca-wordflow --help`.
- Confirm the MSI, DMG, both updater signatures, macOS updater archive, and
  `latest.json` exist in the GitHub Release.
- Install an older signed build and verify both its quiet startup check and
  **Check for Updates…** in the native application menu discover the release.
  The startup check must open the separate native updater window only when the
  release is newer. Install it and confirm the app relaunches into the new
  version.
- Deploy the tagged root commit and current submodule pointers.
- Verify `/health`, hosted login, one Workspace read, and `/api/events` delivery.
