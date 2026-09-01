# Topic modelling best-practice and reduction quality audit

_Research and implementation snapshot: 2026-08-31_

## Decision

The `polars-text` 0.6 pipeline now uses non-overlapping, source-faithful Topic
Segments and calls their document roll-up **Topic Coverage**. It returns no real
Topics when the corpus is too small or HDBSCAN finds only noise. Result-time
Topic reduction uses deterministic cosine average linkage over original Topic
embeddings rather than Ward linkage over reduced coordinates.

Retain five-dimensional PaCMAP for the initial HDBSCAN fit in 0.6. The fixed
comparison below rejects PCA as a replacement: PCA collapsed the labelled
20 Newsgroups subset to two clusters with substantially worse agreement and
returned only noise for the multilingual stress corpus. PaCMAP remained close
to the standard UMAP/BERTopic path on the labelled English corpus, and the
native pipeline produced five Topics with comparable intrinsic separation.

This is a qualified decision, not a claim that PaCMAP is equivalent to UMAP.
The Python PaCMAP reference warns that output dimensions other than two have
not been thoroughly tested, and its clusters were less stable across seeds
than UMAP on two corpora. The implementation therefore keeps an explicit seed,
total shape and finite-value validation, and no silent PCA fallback. A future
reducer change needs a repeatable product benchmark and a separate design
decision.

## Practice review

BERTopic fits one embedding per caller-provided document. Its documented
sliding windows and stride belong to post-fit approximate topic-distribution
estimation, not topic discovery. HDBSCAN density and cluster stability count
observations directly, while c-TF-IDF counts the text assigned to each cluster.
Fit-time overlap would therefore repeat evidence in clustering, representative
terms, and document roll-up. The new non-overlapping owned spans remove all
three biases. ([BERTopic algorithm](https://maartengr.github.io/BERTopic/algorithm/algorithm.html),
[topic distributions](https://maartengr.github.io/BERTopic/getting_started/distribution/distribution.html),
[HDBSCAN algorithm](https://hdbscan.readthedocs.io/en/latest/how_hdbscan_works.html))

The roll-up is not a probabilistic topic model. It is the fraction of a source
document's owned Unicode characters assigned to each hard segment label, with
outlier `-1` retained. “Topic Coverage” states that contract directly. HDBSCAN
soft membership would require an all-points membership matrix, which the
current Rust dependency does not expose. ([HDBSCAN soft clustering](https://hdbscan.readthedocs.io/en/latest/soft_clustering_explanation.html))

Fixed-count reduction now follows current BERTopic's important semantics:
cosine distances over semantic Topic representations and average linkage.
Projection coordinates are presentation only and never drive merges.
([BERTopic topic reduction](https://maartengr.github.io/BERTopic/getting_started/topicreduction/topicreduction.html))

PaCMAP remains a custom Rust-native choice. Its paper evaluates local and
global structure preservation, primarily for two-dimensional visualization;
it does not establish density preservation for HDBSCAN topic discovery. UMAP's
own guidance also warns that dimensionality reduction can create false density
structure and recommends more than two dimensions for clustering. The quality
comparison below is therefore a gate for this implementation choice, not proof
that any reducer preserves the original density perfectly.
([PaCMAP paper](https://www.jmlr.org/papers/v22/20-1061.html),
[UMAP clustering guidance](https://umap-learn.readthedocs.io/en/latest/clustering.html))

## One-time quality comparison

The temporary harness was not added to the repository. It used the resolved
`sentence-transformers/all-MiniLM-L6-v2` embeddings and HDBSCAN with
`min_cluster_size=min_samples=10`. Native, PaCMAP, UMAP, and PCA reported
assignments use seed 42, with seeds 42, 43, and 44 used for reducer stability.
The Python BERTopic row deliberately retains its unseeded default and is one
reference run rather than a stability measurement.

Corpora:

- **20 Newsgroups:** 40 seeded training examples from each of five categories,
  with headers, footers, and quotes removed and whitespace-normalized excerpts
  capped at 600 characters. These category labels are a useful coarse reference.
- **Newstalk:** 222 seeded story title/description excerpts from the six largest
  publisher groups in the local
  [`newstalk_stories.parquet`](../../ldaca-analytics-sample-data/ADO/reddit/newstalk_stories.parquet).
  Publisher is not a ground-truth Topic, so its ARI is reported only as a source-
  association diagnostic.
- **Multilingual synthetic:** 40 parallel Topic-labelled sentences covering
  astronomy, medicine, sport, and climate in ten languages. This is a model-
  language stress test, not a natural-corpus quality estimate.

Metrics use hard assignments, including `-1` for ARI and noise fraction.
Silhouette is cosine silhouette in the original normalized embedding space
after excluding noise. Stability is mean pairwise assignment ARI across the
three seeds. The native row reports the actual automatic-segmentation Rust
pipeline; the other rows cluster one embedding per prepared document. The
20 Newsgroups native run created 202 Topic Segments for 200 documents.

### 20 Newsgroups

| Pipeline | Topics | Noise | Reference ARI | Original-space silhouette | Seed stability |
| --- | ---: | ---: | ---: | ---: | ---: |
| Native `polars-text` | 5 | 0.115 | 0.702 | 0.142 | deterministic at fixed seed |
| PaCMAP 5D + HDBSCAN | 5 | 0.035 | 0.726 | 0.124 | 0.412 |
| UMAP 5D + HDBSCAN | 5 | 0.065 | 0.756 | 0.131 | 0.954 |
| Python BERTopic default | 5 | 0.075 | 0.766 | 0.133 | one run |
| PCA 5D + HDBSCAN | 2 | 0.380 | 0.169 | 0.077 | 1.000 |

### Newstalk

| Pipeline | Topics | Noise | Source-label ARI | Original-space silhouette | Seed stability |
| --- | ---: | ---: | ---: | ---: | ---: |
| Native `polars-text` | 6 | 0.297 | 0.068 | 0.074 | deterministic at fixed seed |
| PaCMAP 5D + HDBSCAN | 6 | 0.505 | 0.033 | 0.133 | 0.334 |
| UMAP 5D + HDBSCAN | 3 | 0.185 | 0.016 | 0.102 | 0.809 |
| Python BERTopic default | 2 | 0.167 | 0.012 | 0.103 | one run |
| PCA 5D + HDBSCAN | 2 | 0.806 | 0.006 | 0.177 | 1.000 |

Newstalk does not choose a universal winner: PCA's higher retained-point
silhouette comes after rejecting more than 80% of documents as noise. PaCMAP
and the native Rust implementation retain substantially more material, while
UMAP is more stable across the tested seeds.

### Multilingual synthetic stress test

| Pipeline | Topics | Noise | Topic-label ARI | Original-space silhouette | Seed stability |
| --- | ---: | ---: | ---: | ---: | ---: |
| Native `polars-text` | 2 | 0.000 | -0.038 | 0.208 | deterministic at fixed seed |
| PaCMAP 5D + HDBSCAN | 2 | 0.000 | -0.038 | 0.208 | 1.000 |
| UMAP 5D + HDBSCAN | 2 | 0.325 | -0.006 | 0.264 | 0.533 |
| Python BERTopic default | 2 | 0.450 | 0.032 | 0.252 | one run |
| PCA 5D + HDBSCAN | 0 | 1.000 | 0.000 | n/a | 1.000 |

No reducer recovered the cross-language semantic labels. The default
all-MiniLM model is therefore not validated for multilingual Topic discovery;
the apparent clusters must not be interpreted as evidence of multilingual
semantic quality. Users needing that contract should select and separately
validate a multilingual Sentence Transformers model. This result does not
justify changing the reducer to PCA.

## Remaining risks and follow-up threshold

- PaCMAP seed sensitivity is the main unresolved reduction risk. Repeat this
  comparison before changing its crate/configuration, embedding model, or
  HDBSCAN implementation.
- `min_samples` remains coupled to `min_topic_size`, matching BERTopic's default
  but changing both minimum size and density conservatism together. Any future
  independent control should be an explicit API decision.
- Treat multilingual quality as unsupported until a labelled, representative
  corpus passes with a declared multilingual model.
- Replace PaCMAP only when a coordinated cross-platform reducer is available
  and improves labelled agreement or stability without PCA's high-noise
  collapse. Do not introduce a data-dependent reducer fallback because the same
  request must keep one deterministic, explainable algorithm.
