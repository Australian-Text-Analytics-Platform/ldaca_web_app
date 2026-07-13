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
make check-topic
make build-basic
make build-tokenization
make build-embedding
make build-topic
```

Default builds enable the full feature set. A no-default-features basic build
contains cleaning and count expressions; cache, tokenization, embedding, and
topic-modeling features add their respective compiled surfaces. Python wrappers
for a disabled feature remain importable but raise a clear runtime error before
registering a missing plugin symbol.

Leave Cargo's job count unset unless an explicit local limit is required.
Timing targets write reports under `target/cargo-timings/`. Tokenizer,
dictionary, and ONNX assets may download on first use.
