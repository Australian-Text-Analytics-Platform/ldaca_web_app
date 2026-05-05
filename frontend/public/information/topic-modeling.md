<!-- markdownlint-disable MD033 -->

<h2 id="info-topic-modeling-overview">About Topic Modelling</h2>

Topic modelling is a way to automatically discover recurring themes in a large collection of documents — without reading them all yourself. You give it hundreds, thousands, or even millions of texts, and it groups them by the ideas they share, then summarises each group with a handful of representative words.

Think of it like sorting a huge pile of mail by subject without looking at every envelope.

The term *topic* here is used in a technical sense — a cluster of words that co-occur across documents — not the everyday sense of a topic an author has chosen. Topic modelling has attracted a lot of debate in the digital humanities and social sciences; a useful overview is in [this open-access article](https://doi.org/10.1177/14614456241293075) and its expert commentaries.

This tool uses [BERTopic](https://maartengr.github.io/BERTopic/index.html), a relatively recent deep-learning method that builds clusters from contextual sentence embeddings. Each document is assigned to exactly one primary topic, while words can appear in several topics with different weights.

<h3 id="info-topic-modeling-what-you-can-do">What you can do with this tool</h3>

- **Explore a corpus** — get a broad sense of what themes run through it without reading every document.
- **Compare two corpora** — see which themes appear in both, which are unique to one, and whether a theme is proportionally more prominent in one than the other.
- **Navigate large collections** — use the topic map to zoom in on areas of interest and find relevant documents quickly.
- **Export your findings** — download the topic chart and a spreadsheet of topics and document counts, or detach selected topics back into the workspace as new derived data blocks.

<h3 id="info-topic-modeling-what-to-expect">What to expect from the results</h3>

Topic modelling is **exploratory**, not definitive. It surfaces patterns worth investigating — it does not label documents the way a human expert would.

A typical result is a bubble map where each bubble is a theme, its size reflects how many documents belong to it, and nearby bubbles share similar language. Each topic also has a short list of the words most associated with it (e.g. *education, school, curriculum, students, funding*).

The tool will always produce *some* result, even on a random collection of texts. The quality of the output depends on whether real themes exist in your data and whether your settings are well-matched to the corpus.

The first time you run topic modelling after starting the app, you will see a delay while the embedding model is loaded into memory (and on the very first run ever, downloaded). Subsequent runs reuse the cached model.

<h3 id="info-topic-modeling-key-decision">Before you run it: one decision that matters most</h3>

**How many documents will the model actually process?**

Embedding (the first and slowest stage) converts every document into a numeric fingerprint. For very large corpora this can take a long time, so the tool lets you work on a random sample. The tool suggests a percentage automatically — for most purposes, a working set of **10,000–50,000 documents** gives good results.

More is not always better: doubling the sample size rarely doubles the quality of topics, but it does roughly double the run time.

The topic-count input changes colour based on the ratio of documents to estimated topics in your current configuration:

- **Orange** — fewer than 10 documents per estimated topic. Topics may be noisy or unstable.
- **Red** — fewer than 3 documents per estimated topic. Results will likely be unreliable or fail entirely.

If you see either colour, hover over the number for a brief explanation, then either increase the working document count or reduce the number of topics you are requesting.

<h3 id="info-topic-modeling-misunderstandings">Common misunderstandings</h3>

**"The tool will tell me what my corpus is about."**
It will show you *statistical* patterns — words that co-occur across many documents. These patterns often correspond to meaningful themes, but they can also reflect writing style, document format, or artefacts in the data. Interpretation always requires human judgement.

**"The topic labels are the actual themes."**
The representative words are the most statistically distinctive words in that cluster. They are a starting point for naming a topic, not a definitive label. Two topics might share some words; a word might appear in topics where it has different meanings.

**"If I ask for 50 topics, I will get 50 topics."**
In the default *Aim Topic No.* mode, the number is a hint. The model may produce more or fewer topics depending on the natural structure of the data. Use *Exact Topic No.* mode if you need a fixed count (though this may merge genuinely distinct themes).

**"Topic −1 means something went wrong."**
No. Topic −1 is the *outlier group* — documents that did not fit neatly into any cluster. A small outlier group is normal and healthy. A very large one (e.g. more than a third of documents) may suggest the topics are too narrow, the corpus is very diverse, or the sample is too small.

**"Running it twice should give the same result."**
Only if you use the same *Random Seed*. The model has a random element. Lock in a seed (the default is 42) if you want reproducible results. Deliberately running with two or three different seeds is also a useful way to check whether the topics are stable.

**"More words per topic means more accurate topics."**
Words per topic only affects how many words are *displayed*. The underlying model is unchanged. More words can help you interpret an ambiguous topic, but the topic itself is the same either way.

<h3 id="info-topic-modeling-caveats">Caveats</h3>

- **Topics reflect language, not intent.** A topic built around the words *fire, smoke, alarm, building* could be about safety compliance, an emergency, a news report, or a novel. Context still matters.
- **Short documents produce weaker topics.** Tweets, headlines, or single sentences give the model less to work with than paragraphs or articles.
- **Rare themes may not appear.** If a theme occurs in only a small fraction of documents, it may fall below the minimum cluster size and be absorbed into the outlier group.
- **The tool is not a classifier.** It discovers themes in the data it is given; it does not assign documents to predefined categories.
- **Sampling introduces variability.** Different random samples from the same corpus can produce somewhat different topics. This is expected — it is a sign the corpus is large and varied, not that something is wrong.

<h3 id="info-topic-modeling-references">Where to read more / get help</h3>

- A critical overview of topic modelling: [this article](https://doi.org/10.1177/14614456241293075) and the accompanying expert commentaries.
- BERTopic documentation: <https://maartengr.github.io/BERTopic/index.html>.
- A notebook version using a different (stochastic block model) approach: <https://github.com/Australian-Text-Analytics-Platform/topsbm>.
- Use the embedded feedback button at the bottom-left of the interface to get in touch with the developer team in the Sydney Informatics Hub.
