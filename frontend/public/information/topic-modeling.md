<!-- markdownlint-disable MD033 -->

<h2 id="info-topic-modeling-overview">About Topic Modelling</h2>

Topic modelling is an exploratory way to find recurring language patterns in a
large collection without reading every document first. Wordflow groups similar
text and summarises each group with statistically representative words.

The unit processed by the model is a **Topic Segment**. Depending on your
segmentation setting, one source document can contribute one or many Topic
Segments. Wordflow embeds and clusters the segments, then combines their topic
assignments into a distribution for the source document.

<h3 id="info-topic-modeling-pipeline">How the result is produced</h3>

1. Automatic, Paragraph, or Sentence segmentation creates Topic Segments.
2. A sentence-transformer model converts each segment into an embedding.
3. PaCMAP reduces the embeddings and HDBSCAN discovers clusters and outliers.
4. Class-based TF-IDF (c-TF-IDF) ranks representative words for each topic.
5. Segment assignments are rolled up to document-level topic distributions,
   weighted by the Unicode-character length of each retained segment.

For keyword extraction, c-TF-IDF combines all Topic Segments assigned to a
topic into one class-level text. The configured vectorizer tokenises that text
and removes applicable stopwords. A term receives a high score when it occurs
often within that topic but is less common across the other topics. The highest
scoring terms become the representative words. They describe distinctive
vocabulary, not necessarily the topic's meaning or an author's intent.

<h3 id="info-topic-modeling-segmentation">Why segmentation matters</h3>

Automatic segmentation retains long-document coverage by splitting and packing
text with limited overlap. Paragraph and Sentence segmentation preserve chosen
semantic boundaries, but an oversized unit keeps only its beginning. The
Maximum tokens per segment control therefore trades local focus against wider
context. Wordflow reports explicit-mode truncation above the Result chart.
Automatic overlap counts repeated text as another observation. All three modes
then use the same downstream modelling pipeline.

<h3 id="info-topic-modeling-what-you-can-do">What you can do</h3>

- Explore prominent and niche language patterns.
- Compare the contribution of two corpora to the same discovered topics.
- Inspect representative words, topic sizes, similarity, and outliers.
- Publish selected topic data and meanings as Derived Data Blocks.

<h3 id="info-topic-modeling-interpretation">Interpret with care</h3>

Topic modelling is not a classifier or a definitive account of what a corpus
is “about”. Clusters can reflect subject matter, genre, author, boilerplate,
document length, or data-cleaning artefacts. Topic −1 is the expected outlier
group rather than an error. Sampling, segmentation, minimum topic size, and the
random seed can all affect the result, so compare configurations and return to
the source documents when naming or interpreting a topic.

Minimum topic size counts Topic Segments, because those are the observations
clustered by HDBSCAN. Bubble size instead remains the integer number of source
documents whose weighted dominant assignment is that topic.

The term *topic* is technical rather than authorial. A critical overview is
available in [this open-access article](https://doi.org/10.1177/14614456241293075)
and its expert commentaries. A notebook using a different stochastic block
model approach is available in [topsbm](https://github.com/Australian-Text-Analytics-Platform/topsbm).
