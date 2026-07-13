# polars-text Release Runbook

`polars-text` publishes maturin-built wheels and one source distribution through
GitHub Actions trusted publishing. Normal pull requests build/test artifacts;
explicit `v*` tags publish to PyPI; manual workflow dispatch may target
TestPyPI.

## One-time Publisher Setup

Configure the PyPI/TestPyPI trusted publisher with:

- owner `Australian-Text-Analytics-Platform`;
- repository `polars-text`;
- workflow `release.yml`;
- the same environment name used by the workflow, or none when no environment
  gate is configured.

The publish job needs only `contents: read` and `id-token: write`. Do not create
a long-lived PyPI token for the normal release path.

## Release

1. Set the same PEP 440 version in `pyproject.toml` and `Cargo.toml`.
2. Run `make build`, `make test`, and `uvx ty check`.
3. Build the wheel and sdist and run `twine check --strict` on `dist/*`.
4. Commit and push the release state.
5. Create and push `v<version>`.
6. Wait for every platform wheel, the sdist, and the publish job.
7. Install the exact version from PyPI and run an import smoke test.

Release candidates use PEP 440 versions such as `0.5.0rc1` and are published by
matching tags. Never reuse a version; failures after publication require a new
release number.
