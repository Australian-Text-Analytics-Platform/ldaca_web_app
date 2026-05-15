<!-- markdownlint-disable MD033 -->

<h2 id="info-quotation-overview">About Quotation Extraction</h2>

- What is this?
This is a tool that identifies and extracts quoted content from newspaper texts. It identifies the quoted content, its speaker, and the quoting expression (e.g. say, claim, admit). It also identifies the type of quote construction. It contains code that was adapted and developed (with permission) from the [GenderGapTracker](https://github.com/sfu-discourse-lab/GenderGapTracker).

This tool has been designed to work with newspaper texts and should not be used for other text types. It will be slow to run the first time due to the needs of downloading necessary model files. Processing large datasets can be quite time consuming, hence Wordflow will process a small batch of documents at each page flipping.

- Can I change any of the settings/parameters?
No. The quotation tool is based on a rigorous set of pre-defined linguistic rules, therefore the user cannot change anything on the interface. There is also a caveat that these fundamental rules are designed to extract quotations from newspaper articles published in North America (Canada), therefore, the accuracy of the tool may be affected when different dialects are processed for extraction.

- Where can I read more about this method?
We recommend reading this [open access article](https://doi.org/10.1515/cllt-2023-0104) or [this blog post](https://www.atap.edu.au/posts/quotation-tool/).

- Is there a notebook version?
Yes. The Quotation tool notebook also includes added functionalities such as classifying the speakers and quoted content according to entity types (e.g. whether the speaker is a person or an organisation). You can find this notebook here: https://github.com/Australian-Text-Analytics-Platform/quotation-tool. Note that this notebook was based on modified functions from the original Gender Gap Tracker functions, in order to include some customised functionalities, statistics and visualisation within the notebook. This means that the results from extracting quotations via the Quotation tool notebook could be slightly different from the results derived from the original codes that is directly integrated within Wordflow.

- Where can I get help?
Please use the embedded feedback button at the bottom left of the interface to get in touch with the developer team in the Sydney Informatics Hub.

