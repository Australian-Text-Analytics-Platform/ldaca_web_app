# polars-source-utils Architecture

`polars-source-utils` is a narrow Rust/PyO3 package for listing and replacing
source paths inside serialized Polars `LazyFrame` plans.

It exists because Workspace copy/import relocation must rewrite scan roots
without collecting a plan or rewriting source data. The package owns the broad
`polars-plan` deserialization feature surface required for that binary
operation; `polars-text` remains focused on text expressions.

The public interface is intentionally small:

- `list_source_paths(plan_path)` returns the plan's referenced source paths.
- `replace_source_paths(plan_path, replacements)` rewrites matching plan paths.

The backend calls these functions only during explicit persistence relocation.
Ordinary Workspace loads do not rewrite serialized plans.
