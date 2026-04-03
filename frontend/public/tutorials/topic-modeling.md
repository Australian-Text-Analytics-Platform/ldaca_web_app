<!-- markdownlint-disable MD033 MD041 -->

[← Back to tutorial index](./index.md)

<h1 id="help-topic-modeling-section">Topic modelling tutorial</h1>

![Topic modelling screenshot](tutorials/assets/topic_modeling.png)

Topic modelling helps you discover themes in a large collection of documents. The app uses [BERTopic](https://maartengr.github.io/BERTopic/index.html) under the hood. There are several other popular topic modelling methods, and they all work differently toward a similar purpose — uncovering semantic themes as topics.

BERTopic is a relatively new deep learning-based topic modelling method that utilises contextual sentence embeddings to generate semantically interpretable text clusters (topics). Unlike traditional LDA (Latent Dirichlet Allocation), in BERTopic every document is associated with only one primary topic, so topics can also be thought of as theme-based document groups. Different topics may share certain common vocabulary at different weights. You can set the number of representative words displayed per topic for easy interpretation.

> **Placeholder (image):** Screenshot of topic modelling setup panel and results.

<h2 id="help-topic-modeling-parameters">Parameter panel</h2>

Use the parameter panel to pick your data blocks and set the topic size. The app allows you to select either one or two data blocks at a time. When two data blocks are selected, their text columns are combined for topic modelling, and the results show a comparison of topics between the two data blocks.

<h3 id="help-topic-modeling-min-topic-size">Minimum topic size</h3>

This setting controls the smallest number of documents that can form a topic.

- Smaller values produce more topics, and certain topics are associated with fewer documents (smaller clusters, higher specificity).
- Larger values produce fewer topics, and topics are associated with more documents (larger clusters, broader meanings).

**Q: How do I choose a good value for min topic size?**

Start with a moderate value (10–20 documents) and adjust until the topics feel meaningful for your dataset size.

<h3 id="help-topic-modeling-random-seed">Random seed</h3>

The random seed controls the reproducibility of topic modelling results. Setting a fixed seed ensures the same analysis on the **same data** produces identical topics each time.

- Use any non-negative integer (e.g. 0, 42, 12345).
- Change the seed to explore alternative topic groupings from the same data.
- Remember the seed value when you want consistent, reproducible results.

**Q: Does the seed affect topic quality?**

No — different seeds may produce slightly different topic assignments, but the overall quality depends on your data and the minimum topic size setting.


<h3 id="help-topic-modeling-representative-words">Representative Words to Show</h3>

This is the number of representative words (top N) displayed for each topic. Each topic may contain many words from the vocabulary, but only the top N representative words are shown for easy interpretation. This parameter only affects the visualisation and has no impact on the quality of topic modelling.

<h2 id="help-topic-modeling-results">Result panel</h2>

Use the result panel to explore the topic map, labels, and summary counts. You can also select topics of interest and extract the relevant documents from the data block(s) into new derived data blocks for further analysis.

![Topic modelling results](tutorials/assets/topic_modelling/results.png)

<h3 id="help-topic-modeling-bubble-chart">Bubble Chart</h3>

Each circle in the bubble chart represents an individual topic, named sequentially from Topic 0. When you hover over a bubble, the representative words and the number of documents associated with that topic are displayed.

The size of each bubble corresponds to the number of associated documents, and the colour blends the data block colours proportionally to document count.

The distance between two topic bubbles indicates their semantic similarity — the closer two topics appear on this chart, the more similar they, and their associated documents, are to each others.

You can click to select or deselect a topic in the bubble chart. Your selection is also reflected in the bottom pane, where all topics are listed in two columns. Selecting topics lets you extract only the documents associated with those topics from the data block(s) as new derived data blocks.

A quick wildcard filter can be applied using the **text input** in the right ("All Topics") column, which lets you quickly find all topics that contain a keyword of interest.

<h3 id="help-topic-modeling-clear-results">Clear results</h3>

Topic modelling results are saved in the backend so this tab can reload and keep persistent pages of the last run. **Clear Results** clears the cached result in the backend and resets the tab.

## Practice exercise

1. Run topic modelling with the default minimum topic size.
2. Increase and decrease the minimum topic size and compare topic granularity.
3. Record which setting gives clearer topic labels for your corpus.

[← Back to tutorial index](./index.md)
