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
2. Confirm Python Polars and both Rust Polars tags are the same release.
3. Compile every supported Cargo feature configuration, run strict all-target
   Clippy, rebuild the full optimized extension, then run `make test` and
   `uvx ty check`.
4. Build Linux x86-64, macOS arm64, and Windows x86-64 wheels. Install each
   wheel and run an extension import plus a representative native operation.
5. Build the sdist and run `twine check --strict` on every distribution.
6. Commit and push the release state.
7. Create and push `v<version>`.
8. Wait for every platform wheel, the sdist, and the publish job.
9. Install the exact version from PyPI and repeat the import/native smoke test.

Release candidates use PEP 440 versions such as `0.6.0rc1` and are published by
matching tags. Never reuse a version; failures after publication require a new
release number.
