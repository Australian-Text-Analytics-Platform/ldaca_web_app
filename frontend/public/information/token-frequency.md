<!-- markdownlint-disable MD033 -->

<h2 id="info-token-frequency-overview">About Token Frequency Analysis</h2>

Token Frequency
- What is this?
This tool retrieves each token (~word) in your text / text collection. It creates a word cloud visualisation as well as a frequency list (= a list of each word and the raw/absolute frequency with which it occurs). You can download both to your Downloads folder.

- What do I need to know before using this?
Your textual data should be consistently encoded (UTF8) and should not contain any xml tags. If necessary, you can use the Data Preprocessing to remove any content within angle brackets. Search for this regex pattern *'<[^>]+>'* in the ‘document’ text column of your collection and replace with empty string.

The word cloud currently displays the top 25 tokens by default. Because of known limitations of such visualisations and critiques of how they represent frequency, it is recommended to use the frequency list for analysis rather than relying on the word cloud visualisation.

The output differs depending on how a ‘token’ is defined. For example, whether punctuation counts as a token, whether a word like high-school is treated as one or two tokens or whether contractions like you’re, don’t, isn’t are treated as one or two tokens. The default tokeniser included in this tool is the [Bert-base-uncased](https://huggingface.co/google-bert/bert-base-uncased). Key behaviors of this tokenizer:

> - **Lowercases** text (uncased model);
> - **Punctuation** is split into separate tokens (e.g., "don't" → "don", "'", "t");
> - **Hyphenated words** like "high-school" are split (e.g., "high", "-", "school");
> - **Contractions** like "you're" are split at the apostrophe.

The frequency list that you can download includes the raw/absolute frequencies for each token (word). When comparing token frequency across different text collections yourself, you need to normalise the raw/absolute frequencies if the text collections have different sizes (for example, you can calculate a frequency per 100,000 words using Excel). Alternatively, if you select two data blocks (two text collections) within the Token Frequency tool, you can use the tool to identify the key words in a text collection by using in-built statistical measures (this is commonly called keywords analysis in corpus linguistics). Key words are words that are (statistically speaking) unusual in their frequency in the *study* text collection, through comparison to the *reference* text collection. You can only create a list of key words when you compare two text collections.

**Q&A**
- Can I change any of the settings/parameters?
Yes. You can change the word cloud so that it displays more than just the top 25 tokens, although there is an upper limit of 100 tokens. 
You can also adjust the token frequency list by using stop words – words that will not be included. You can do this manually (by writing your own stop words or by right-clicking a word in the list to add it as a stop word) or by filling the default stop list (which comes from NEED info / link). 
When doing a keywords analysis, you can change the order in which keywords appear by sorting them differently. [anything else you can change?]

- Where can I read more about this method?
Token frequency: link to LDACA site? https://www.atap.edu.au/text-analysis/methods/ 
Keywords: link to LDACA site? https://www.atap.edu.au/text-analysis/methods/ 

- Is there a notebook version?
Yes, there is a legacy notebook for keywords analysis. You can access this here: https://github.com/Australian-Text-Analytics-Platform/keywords-analysis 

- Where can I get help?
Please use the embedded feedback button at the bottom left of the interface to get in touch with the developer team in the Sydney Informatics Hub.

