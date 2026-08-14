<!-- markdownlint-disable MD033 MD041 -->

[← Back to tutorial index](./index.md)

<h1 id="help-topic-modeling-section">Topic modelling tutorial</h1>

![Topic modelling parameter panel](tutorials/assets/topic_modelling.png)

Topic modelling discovers recurring themes in a collection. Wordflow divides
each document into **Topic Segments**, embeds those segments, groups similar
segments, and rolls their topic assignments back up to each source document.

<h2 id="help-topic-modeling-parameters">Parameter panel</h2>

<h3 id="help-topic-modeling-data-block">Step 1 — Select your data</h3>

Choose one or two Data Blocks and select the text column for each. A two-block
run fits one shared model and shows how each topic is distributed between the
two corpora.

<h3 id="help-topic-modeling-sampling">Step 2 — Choose a sample</h3>

Each Data Block has an independent sampling percentage. The default is 100%.
Lower sampling makes exploratory runs faster but can hide rare themes or make
small topics less stable. The label reports the effective document count.

<h3 id="help-topic-modeling-options">Step 3 — Configure the model</h3>

<h4 id="help-topic-modeling-segmentation-method">Segmentation method</h4>

This setting controls which spans become Topic Segments. The same method is
used for every selected Data Block.

| Method | Boundary behavior | Oversized text |
| --- | --- | --- |
| **Automatic** | Splits blank-line blocks, then Unicode sentences and token-length units; packs nearby units with a small overlap | Subdivided so later text remains represented |
| **Paragraph** | Each trimmed, non-empty newline-delimited line is one Topic Segment | Keeps only the beginning up to the token cap |
| **Sentence** | Each Unicode UAX #29 sentence is one Topic Segment | Keeps only the beginning up to the token cap |

Paragraph means a physical non-empty line, not a blank-line block. Sentence
uses a language-independent Unicode boundary algorithm, so abbreviations may
occasionally form a short segment.

<h4 id="help-topic-modeling-max-segment-tokens">Maximum tokens per segment</h4>

Sets the maximum size of a Topic Segment in model tokens. The default is 256
and the allowed range is 32–510. Tokens may be complete words or parts of
words. A smaller cap gives more local observations; a larger cap gives each
observation more context.

In Paragraph and Sentence modes, an over-cap segment is right-truncated rather
than split. After the run, a warning reports how many segments lost tail text.
Automatic mode may overlap adjacent segments; its hidden overlap is one eighth
of the cap, up to 32 tokens.

<h4 id="help-topic-modeling-min-topic-size">Minimum topic size</h4>

The smallest number of Topic Segments that can form a topic. The default is 10.
Higher values usually create fewer, broader topics and more outliers; lower
values allow smaller themes but can create noisier topics. The final topic
count is determined by the data rather than requested directly.

<h4 id="help-topic-modeling-random-seed">Random seed</h4>

Controls stochastic dimensionality reduction. The default is 0. Keep the same
seed to reproduce a configuration, or compare several seeds to assess topic
stability.

<h2 id="help-topic-modeling-run">Step 4 — Run the analysis</h2>

Choose **Run Analysis**. The native pipeline constructs Topic Segments, embeds
them with the configured sentence-transformer model, reduces the embeddings
with PaCMAP, clusters them with HDBSCAN, calculates c-TF-IDF representative
words, and saves the Result. The first run can be slower while model resources
are loaded or downloaded.

Every mode uses this same downstream pipeline. Each Topic Segment is one equal
clustering observation. When assignments are rolled back to documents, each
segment is weighted by the Unicode-character length of its retained text;
Automatic overlap therefore counts repeated source text again. Outlier weight
remains part of the normalized Topic Distribution.

Parameters are locked while a Result exists. **Clear Results** removes the
Analysis and unlocks the controls; your segmentation method and token cap stay
selected.

<h2 id="help-topic-modeling-results">Result panel</h2>

![Topic modelling results](tutorials/assets/topic_modelling/results.png)

<h3 id="help-topic-modeling-words-per-topic">Words per topic and stop words</h3>

**Words per topic** controls how many representative words appear in the topic
list, search, and hover cloud. The default is 15 and the range is 3-100. Enable
the stopword filter to apply the Tab's saved list. You can choose a language or
edit that list while filtering is off; the switch controls filtering only.
Opening the language menu detects a recommendation from the first selected Data
Block. Choosing a language replaces the saved list, while **Clear stop words**
empties it. The menu returns to **Saved list (N words)** after a language is
chosen. These controls change presentation without rerunning or refetching the
Result.

<h3 id="help-topic-modeling-bubble-chart">Bubble chart</h3>

Each bubble is a discovered topic. Bubble size reflects the documents whose
dominant assignment is that topic; in a two-corpus run, colour composition
shows the corpus split. Nearby bubbles have more similar topic representations.
Topic −1 contains outlier documents that did not fit a discovered cluster.

Hover for a representative-word cloud. Word order reflects c-TF-IDF
distinctiveness, while word size reflects occurrences in assigned Topic
Segments; automatic overlap can therefore count repeated source text. These are
not source-document frequencies. Select topics, search the topic
list, reset the zoom, or choose **Add to Workspace** to publish selected topic
data and linked topic meanings as Derived Data Blocks.

If Paragraph or Sentence segments were over the token cap, an amber message
above the chart reports the truncated count and reminds you that their later
text was not modelled.

<h3 id="help-topic-modeling-clear-results">Clear results</h3>

**Clear Results** removes the retained Analysis and Result. The selected
segmentation method and maximum-token value remain available for the next run.

<h2 id="help-topic-modeling-troubleshooting">Troubleshooting</h2>

| Symptom | What to try |
| --- | --- |
| Almost all documents are outliers | Lower Minimum topic size, increase sampling, or check whether the corpus has shared themes |
| Topics change substantially between runs | Increase sampling and compare runs with fixed seeds |
| Representative words describe formatting rather than subject matter | Clean boilerplate or choose a segmentation method that better matches the document structure |
| Many segments are truncated | Increase Maximum tokens per segment or use Automatic segmentation |
| Run time is very long | Reduce the per-Data-Block sampling percentage |

<h2 id="help-topic-modeling-defaults">Quick-reference defaults</h2>

| Setting | Default |
| --- | --- |
| Sampling | 100% per Data Block |
| Segmentation method | Automatic |
| Maximum tokens per segment | 256 |
| Minimum topic size | 10 |
| Random seed | 0 |
| Words per topic | 15 |

## Practice exercise

1. Run a corpus with Automatic segmentation.
2. Clear the Result, choose Paragraph or Sentence, and run again with the same
   sample, seed, and minimum topic size.
3. Compare the topic map, representative words, outlier share, and any
   truncation warning.

[← Back to tutorial index](./index.md)
