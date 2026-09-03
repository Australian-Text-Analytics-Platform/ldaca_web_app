# Tasks

- [x] Record current backend, dependency, OpenAPI, and frontend baselines.
- [x] Remove unreachable paged Result tables and the duplicate quotation resolver.
- [x] Deepen shared filesystem and private TOML persistence modules.
- [x] Move input snapshots and Topic projection codecs to their owning layers.
- [x] Share fair scheduling and supervised process mechanics without a Task resource.
- [x] Introduce typed worker inputs and focused Analysis preparation modules.
- [x] Deepen Annotation and Quotation provider adapters.
- [x] Update the separately controlled remote Quotation engine to the strict v2
  contract, remove its CLI/sample/log/bytecode and unrelated utility residue,
  and verify it end to end with Wordflow's remote adapter.
- [ ] Deploy the strict v2 remote Quotation engine before enabling Wordflow's
  remote adapter. This needs the deployment target and separate authorization.
- [x] Keep the spaCy pipeline out of package metadata and acquire model data
  lazily into the OS-native application cache without modifying signed runtimes.
- [x] Upgrade direct dependencies and modernize Python 3.14 and FastAPI typing.
- [x] Land the original native schema 22, archive format 21, hosted SQLite
  schema 7, and import envelope 1 cutover.
- [x] Replace the later monolithic native schema 23 and archive format 22 with
  data schema 1, archive data format 1, and independent Analysis-kind version 1
  envelopes; preserve incompatible native records and omit them portably with
  warning counts.
- [x] Replace Tab and Result contracts and regenerate frontend consumers.
- [x] Add unavailable child resources with in-place current-schema isolation.
- [x] Complete every persistence-integrity boundary and recovery test.
- [x] Remove SQLite initialization and quota/session use from single-user mode
  while preserving hosted schema validation and existing Data Root files.
- [x] Update durable docs and run backend, frontend, docs, and package gates.

## Acceptance evidence (2026-08-30)

- Backend: Ruff and `ty` pass; Pytest reports 821 passing tests with one
  upstream `google-genai` Python 3.14 deprecation warning.
- API and frontend: the OpenAPI client was regenerated; the full frontend
  check passes with 274 test files and 1,354 tests, lint, type checks,
  dead-code analysis, production build, documentation drift, and version
  checks.
- Rendered UI: an isolated current-schema Data Block corruption produces the
  unavailable warning while a healthy sibling remains selectable and its rows
  load in the Data View; the browser reported no framework overlay or console
  warnings/errors.
- Packaging: the backend wheel and source distribution install in a clean
  environment without an `en_core_web_md` package requirement; first-use model
  acquisition targets the OS-native application cache. Local Quotation smoke
  coverage and the staged desktop backend import, startup, health, and shutdown
  probe pass.
- Remote Quotation engine: 13 tests plus formatting, Ruff, and `ty` checks for
  service-owned code pass in a clean Python 3.14 environment. The locked
  `en_core_web_md` package loads directly, and a live engine served an ordered
  two-document batch to Wordflow's real remote client with exact multilingual
  source-aligned speaker, verb, and quotation offsets. The Docker image and
  deployment remain unverified because the local Docker daemon is unavailable
  and no deployment target was provided.
- Rust and documentation: Cargo tests and Clippy pass, and internal Markdown
  links and Mermaid fences validate.
- The implementation was recorded as local commits only. No push, release,
  signed desktop artifact, live migration, or old-format conversion was
  performed.

## Granular versioning acceptance evidence (2026-09-01)

- Backend Ruff and Ty pass; Pytest reports 826 passing tests.
- The regenerated OpenAPI client, frontend lint, production build, and all 275
  frontend test files with 1,360 tests pass.
- Cargo formatting, 26 runnable tests, and Clippy with warnings denied pass; one
  packaged-runtime probe remains intentionally ignored without a packaged
  desktop bundle.
- Documentation links, bundled-document drift, and `git diff --check` pass.
