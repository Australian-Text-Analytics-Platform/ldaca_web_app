<!-- markdownlint-disable MD033 MD041 -->

[← Back to tutorial index](./index.md)

<h1 id="help-topic-modeling-section">Topic modeling tutorial</h1>

![Topic modeling screenshot](tutorials/assets/topic_modeling.png)

Topic modeling helps you discover themes in a large collection of documents. The app uses BERTopic under the hood.

> **Placeholder (image):** Screenshot of topic modeling setup panel and results.

<h2 id="help-topic-modeling-parameters">Parameter panel</h2>

Use the parameter panel to pick your data blocks, set topic size, and decide how keywords are scored.

<h3 id="help-topic-modeling-min-topic-size">Minimum topic size</h3>

This setting controls the smallest number of documents that can form a topic.

- Smaller values produce more, smaller topics.
- Larger values produce fewer, broader topics.

**Q: How do I choose a good value?**

Start with a moderate value and adjust until the topics feel meaningful for your dataset size.

<h3 id="help-topic-modeling-ctfidf-toggle">c-TF-IDF toggle</h3>

This toggle controls how topic keywords are scored. When enabled, it highlights terms that are distinctive to each topic.

- **On**: more distinctive topic keywords.
- **Off**: more frequency-driven keywords.

<h2 id="help-topic-modeling-results">Result panel</h2>

Use the result panel to explore the topic map, labels, and summary counts.

<h3 id="help-topic-modeling-clear-results">Clear results</h3>

Topic modeling results are saved in the backend so this tab can reload and keep persistent pages of the last run. **Clear Results** clears the cached result in the backend and resets the tab.

## Practice exercise

1. Run topic modeling with the default minimum topic size.
2. Toggle c-TF-IDF on and off to compare keyword lists.
3. Record which setting gives clearer topic labels.

[← Back to tutorial index](./index.md)
