<!-- markdownlint-disable MD033 MD041 -->

[← Back to tutorial index](./index.md)

<h1 id="help-quotation-section">Quotation Tool tutorial</h1>

![Quotation extraction screenshot](tutorials/assets/quotation_extraction.png)

The quotation Tool is a specialised tool customised for identified quotation, speaker and relevant  linguistic information from news articles. This tool is reusing codes from the [Gender Gap Tracker](https://github.com/sfu-discourse-lab/GenderGapTracker) project developed by the Discourse Processing Lab, Simon Fraser University, Canada.

**Disclaimer**: The quotation tool is a rule based algorithm developed by linguistists in a Canadian media research context, therefore the keywords, spelling and grammar rules may not have the best performance for analysing other types of texts (e.g. social media, novel) or in different English contexts (e.g. dialects, UK spelling, historical newspaper etc.). Please understand no algorithmic approach can guarantee 100% precision and make sure you always check the results in scale to understand the limitations, common mistakes and overall performance on your own text collection before proceeding to any conclusion.

> **Placeholder (image):** Example of quotation extraction results with context columns.

<h2 id="help-quotation-parameters">Parameter panel</h2>

Use the parameter panel to select the text column and configure the context window for display.

<h3 id="help-quotation-context-length">Quotation context length</h3>

This setting controls how many words are extracted as contexts before and after a found quotation entity. The actual quotation related entities are extracted in separate columns and this parameter is to give the user some contexts to evaluate the extracted quotations better.

<h2 id="help-quotation-results">Result panel</h2>

Use the result panel to review extracted quotations and metadata.

The pagination footer shows **Documents searched per page (N matches found)** so you can see how many source documents on the current page produced at least one quotation row.

If a source document on that page has no extracted quotation, it does not appear as a row in the result table.

![Quotation detach](tutorials/assets/quotation_tool/detach_options.png)

The quotation extractions can be further analysed with other tools, therefore the results can be detached as a new derived data block like other tools. Clicking the detach button brings you a pop-up window to decide what metadata columns from the parent data block shall be brought over to the new data block.

<h3 id="help-quotation-clear-results">Clear results</h3>

Quotation results are saved in the backend so the tab can reload and keep persistent pages. **Clear Results** clears the cached result in the backend and resets the tab.

<h2 id="help-quotation-engine">Service engine setting</h2>

![Quotation engine setting](tutorials/assets/quotation_tool/engine_setting.png)

Being a specialised tool developed several years ago, the core functions and model of the quotation tool is not included as part of the webApp. In order to keep the original quotation tool running under a consistent environment, the LDaCA team hosts it as a service on the Nectar cloud, which can be configured in the webApp for extracting quotations remotely. Click on the small gear icon when hovering the mouse on the quotation tab for configuring the endpoint of remote service.

![Quotation engine configure](tutorials/assets/quotation_tool/engine_remote.png)

The default remote endpoint is http://legacy-tools.ldaca.edu.au:8801/api/v1/quotation/extract. Due to the limited computing resources allocated to this remote service, there are size limit and rate limit for processing large amount of texts remotely. Please do not send too many documents and requests to the endpoint, and be prepared to slow process when you detach the results. 

It is possible for the user to host the tool locally as a decicated service for faster proessing speed. The LDaCA text analytic team have dockerised the original quotation tool so it's relatively easy to deploy if you know how to work with [Docker](https://www.docker.com/). Please contact [sih.info@sydney.edu.au](mailto:sih.info@sydney.edu.au) if you have such need.

## Practice exercise

1. Run quotation extraction with a short context length.
2. Increase the context length and compare the results.
3. Decide which setting supports your research question best.

[← Back to tutorial index](./index.md)
