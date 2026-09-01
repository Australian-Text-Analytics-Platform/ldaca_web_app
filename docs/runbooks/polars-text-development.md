# polars-text Development Runbook

From `polars-text/`:

```bash
make build
make test
uvx ty check
```

For faster Rust iteration, use the feature-scoped targets:

```bash
make check-basic
make check-tokenization
make check-embedding
make check-tokenization-embedding
make check-topic
make build-basic
make build-tokenization
make build-embedding
make build-tokenization-embedding
make build-topic
```

Default builds use `full = ["topic-modeling"]`; topic modeling enables its
tokenization, embedding, and internal cache prerequisites. Base, tokenization,
embedding, tokenization-plus-embedding, topic, and full configurations must all
compile. Run strict Clippy before handoff:

```bash
cargo clippy --all-targets --all-features --locked -- -D warnings
```

Direct PyO3 functions are compiled and registered only with their owning Cargo
feature. Feature-scoped builds replace the same editable extension file, so
always finish with `uv run make build` before Python acceptance.

Leave Cargo's job count unset unless an explicit local limit is required.
Tokenizer, dictionary, and ONNX assets may download on first use.
