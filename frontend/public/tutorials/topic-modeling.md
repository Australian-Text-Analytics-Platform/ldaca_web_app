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

<h4 id="help-topic-modeling-min-cluster-size">Min topic size</h4>

Sets the smallest number of Topic Segments that can form a natural HDBSCAN
Topic. The default is 10 and the minimum is 2. Smaller values can produce more,
finer natural Topics but may be noisier; larger values require more supporting
segments per natural Topic. Changing this value requires a new run.

<h4 id="help-topic-modeling-random-seed">Random seed</h4>

Controls stochastic dimensionality reduction. The default is 0. Keep the same
seed to reproduce a configuration, or compare several seeds to assess topic
stability.

<h2 id="help-topic-modeling-run">Step 4 — Run the analysis</h2>

Choose **Run**. The native pipeline constructs Topic Segments, embeds
them with the configured sentence-transformer model, reduces the embeddings
with PaCMAP, clusters them with HDBSCAN, calculates c-TF-IDF representative
words, and saves the Result. The first run can be slower while model resources
are loaded or downloaded.

Every mode uses this same downstream pipeline. Each Topic Segment is one equal
clustering observation. When assignments are rolled back to documents, each
segment is weighted by the Unicode-character length of its retained text;
Automatic overlap therefore counts repeated source text again. Outlier weight
remains part of the normalized Topic Distribution.

The **Run** label never changes. Parameters lock while the Analysis is
submitting, queued, or running, then unlock after success. Changing an
execution parameter enables Run again; reverting exactly to the submitted
request disables it. Words per topic, stop words, search, selection, and chart
controls are presentation-only and do not enable Run. After failure or
cancellation, Run stays disabled until **Clear Results** removes the Analysis;
your segmentation method, token cap, and Min topic size stay selected.

<h2 id="help-topic-modeling-results">Result panel</h2>

![Topic modelling results](tutorials/assets/topic_modelling/results.png)

<h3 id="help-topic-modeling-number-of-clusters">Number of topics</h3>

The Result starts at HDBSCAN's natural number of real Topics. Use **Number of
topics** to merge that fit down to two Topics without rerunning embedding or
dimensionality reduction. Topic −1 is an outlier group, remains unchanged, and
does not count toward the displayed number. Results with zero, one, or two real
Topics show a fixed disabled control.

The lower bound appears to the left of the slider. Change the topic count with
either the slider or the number field on its right; both stay synchronized.
Wordflow requests one projection after you commit either control. The current
chart remains visible with
**Updating topics…** until the new representative words, coordinates, sizes,
and document assignments arrive. A failed request restores the previous value.
Changing the count clears Topic selection and chart hover or zoom state. Search,
stop words, and Words per topic remain in place.

A successfully applied non-default projection is remembered for the same
Analysis. If a lower cluster count cannot support the current Top topics per
row, Wordflow sends one update with that value clamped to the new count.
Rerunning creates a new Analysis at its natural count and Top 2. Export and Add
to Workspace use the displayed successful projection and are unavailable while
an update is pending.

<h3 id="help-topic-modeling-top-topics-per-row">Top topics per document</h3>

**Top topics per document** controls how many of each source row's strongest
positive real-topic shares contribute to bubble counts. The default is 2. Topic
−1 and zero shares never count. If several Topics tie at the cutoff, all tied
Topics count, so one row may contribute to more than this number and to several
bubbles. The question-mark tooltip beside the control summarizes this counting
behaviour.

Enter a value and press Enter or leave the input to request one update. Partial
input and the already-applied value make no request. Changing only this value
updates bubble sizes, corpus composition, Topic lists, tooltip counts, CSV, and
publication membership without moving the Topic layout or clearing selection,
search, lasso filters, pan, zoom, or an open Add to Workspace dialog.

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

Each bubble is a discovered topic. Bubble size reflects source rows whose
positive share for that Topic is within the displayed Top topics per document; in a
two-corpus run, colour composition compares the Topic's share of each analyzed
corpus, then normalizes those two shares for the colour blend. This prevents a
larger corpus from dominating the colour solely because it has more rows. A row
may count in multiple bubbles, so bubble totals need not equal the source-row
count. Nearby bubbles have more similar topic representations. Topic −1 remains
an outlier group and is not a real-Topic bubble membership. Topics with a total
bubble count of zero are omitted from the graph but remain available in the
Topic lists and Result data.

Hover for a representative-word cloud. Word order reflects c-TF-IDF
distinctiveness, while word size reflects occurrences in assigned Topic
Segments; automatic overlap can therefore count repeated source text. These are
not source-document frequencies.

Drag empty graph space to pan and scroll or pinch to zoom. The graph initially
fits every bubble; use **Fit view** to restore that complete view after moving
around. Select topics directly, or enable the lasso control and draw around
several Topic centres. Lasso mode remains active and later strokes add to the
filter shown in **All Topics**; use **Clear filter** in the graph toolbar to
remove that accumulated filter without changing manually selected Topics.
Search further narrows the filtered list. Choose **Add to Workspace** to publish
manually selected topic data and linked topic meanings as Derived Data Blocks.

The download control exports the current panned and zoomed graph viewport. Its
header records Data Block, cluster count, Top topics per document, random seed, and
Topic count. CSV output continues to contain the complete projected Topic
result and its current counts.

If Paragraph or Sentence segments were over the token cap, an amber message
above the chart reports the truncated count and reminds you that their later
text was not modelled.

<h3 id="help-topic-modeling-clear-results">Clear results</h3>

**Clear Results** removes the retained Analysis and Result. The selected
segmentation method, maximum-token value, and minimum cluster size remain
available for the next run.

<h2 id="help-topic-modeling-troubleshooting">Troubleshooting</h2>

| Symptom | What to try |
| --- | --- |
| Almost all documents are outliers | Increase sampling, try another segmentation method, or check whether the corpus has shared themes |
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
| Min topic size | 10 |
| Random seed | 0 |
| Top topics per document | 2, or the available Topic count when smaller |
| Words per topic | 15 |

## Practice exercise

1. Run a corpus with Automatic segmentation.
2. Change Top topics per document and compare bubble membership without moving the map.
3. Move Number of topics down and compare the merged representative words.
4. Clear the Result, choose Paragraph or Sentence, and run again with the same
   sample and seed.
5. Compare the topic map, representative words, outlier share, and any
   truncation warning.

[← Back to tutorial index](./index.md)
