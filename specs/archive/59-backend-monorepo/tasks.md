# Tasks

- [x] Create issue #59 and branch `refactor/backend-monorepo` from `dev`.
- [x] Import the frozen backend snapshot as ordinary tracked files.
- [x] Keep the generated SPA archive out of Git and relocate workflows.
- [x] Verify the imported snapshot against the recorded tree.
- [x] Pass backend, frontend, documentation, build, and distribution checks.
- [x] Push the feature branch and pass unified CI and desktop build checks.
- [x] Fast-forward and verify `dev`, then `main`.
- [x] Configure the new PyPI trusted publisher.
- [x] Retire and archive the standalone backend repository.
- [x] Record completion evidence, archive this spec, and close issue #59.

## Completion evidence

- Feature CI: [run 31672619924](https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/actions/runs/31672619924)
- `dev` CI: [run 31676682352](https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/actions/runs/31676682352)
- `main` CI: [run 31681281895](https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/actions/runs/31681281895)
- Non-publishing Windows and macOS desktop builds: [run 31681302823](https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/actions/runs/31681302823)
- Production PyPI trusts `Australian-Text-Analytics-Platform/ldaca-wordflow`
  workflow `release.yml` with no environment restriction. The old publisher
  remains temporarily until the first successful root-origin package release.
- The standalone backend `main` and `dev` branches end at archival pointer
  commit `56f1c3f7e9518d986a9556fbd96db230ddb0d401`; Actions are disabled and the
  repository is archived.
- No production version tag or package release was created. The registry-only
  smoke install continues to fail closed until `polars-text` 0.5.0 is
  available from the configured package index.
