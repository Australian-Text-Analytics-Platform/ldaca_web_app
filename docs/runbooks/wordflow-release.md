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
uvx ty check
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

The root release workflow verifies tag/version identity, builds Windows MSI and
macOS app/DMG assets, and attaches them to the GitHub release. Do not hand-edit
version strings or reuse a published package version.

## Post-release

- Install the exact backend version with `uvx --from ldaca-wordflow==<semver>
  ldaca-wordflow --help`.
- Confirm desktop assets exist for both platforms.
- Deploy the tagged root commit and current submodule pointers.
- Verify `/health`, hosted login, one Workspace read, and one Task event stream.
