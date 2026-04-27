<!-- markdownlint-disable MD033 -->

<h2 id="info-topic-modeling-overview">About Topic Modeling</h2>

- What is this?
Topic modelling is a cover term for a set of semiautomated techniques that aim to analyse the content of texts. Given a text collection, topic modelling will generate a number of topics that occur in this text collection.

The term topic is not used in its everyday sense but in a technical and highly specific context, referring to clusters of words (with a certain probability distribution) that co-occur (semantically interpretable text clusters). You should be aware that topic modelling has attracted many critiques and a lot of debate. A summary can be found in this [open access article](https://doi.org/10.1177/14614456241293075).

Different methods or models of doing topic modelling exist. Our tool uses [BERTopic](https://maartengr.github.io/BERTopic/index.html), a relatively new deep learning-based method that utilises contextual sentence embeddings to generate topics. The BERTopic can be also be considered as a document clustering method, in which every document in the text collection can only be associated to one topic, whereas each word in the vocabulary can be found in multiple topics as the top words.

At the first time of using Topic Modelling in the webApp, you will expect some delay for the program to download the online model files. This is a once off process, but if you work with large datasets, the topic modelling is a significantly heavier computating task than other tools.

- Can I change any of the settings/parameters?
Yes, you can change the minimum topic size, the random seed that is used, and the number of words that are shown. Setting a random seed means that the same analysis on the same data produces identical topics each time. This is therefore important for ensuring reproducibility/repeatability.

- Where can I read more about this method?
In [this article](https://doi.org/10.1177/14614456241293075) and the accompanying expert commentaries.

- Is there a notebook version?
Yes, there is a notebook version, but it uses a different approach to topic modelling, namely an approach that is based on stochastic block models: https://github.com/Australian-Text-Analytics-Platform/topsbm

- Where can I get help?
Please use the embedded feedback button at the bottom left of the interface to get in touch with the developer team in the Sydney Informatics Hub.
