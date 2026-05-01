<!-- markdownlint-disable MD033 -->

<h2 id="info-concordance-overview">About Concordance Search</h2>

- What is this?
A concordance is a display of every single instance of a search term in your text / text collection, together with words on the left and on the right. This shows you how the words are used in your data and is useful for qualitative analysis and identifying patterns (by sorting what occurs to the left and right).

- What do I need to know before using this?
Your textual data should be consistently encoded (UTF8) and should not contain any xml tags. If necessary, you can use the Data Preprocessing to remove any content within angle brackets. Search for this regex pattern <[^>]+> in the ‘document’ text column of your collection and replace with empty string.

The default is to search for *whole words*. For example, a search for student will retrieve student but not students. If you untick the default, results will show all words that contain the search expression but which may include irrelevant results. 

You can use regular expressions to search for various word patterns, or combinations of words. For example, if you tick the regular expressions box and input _“child\w*”_ (without the quotation marks), it will retrieve any word starting with the string child (followed by zero or more characters) – such as child, children, childhood. If you want to retrieve all the hashtags in your data, you can use the regular expression _“#\w+”_ (without the quotation marks). This will retrieve anything starting with a hashtag followed by one or more characters. Another example is _“tax|budget|walfare”_ can be used search three words at one time. For more understanding to the Regular Expression, please refer to online tutorials like [RegexOne](https://regexone.com/), or ask any Gen-AI models to create the useful RegEx patterns for you.

If you tick ‘case sensitive’ the results for students will only show you instances of student but not Students. The default is for results to include all instances (case in-sensitive), but you can adjust this if you want results for Apple but not apple, for example.

**Q/A**

Can I change any of the settings/parameters?
Yes, you can adjust how many words you want to be included on the left and on the right of the search term/expression. You can also change the default options.

In addition, you can choose to view the dispersion – how the search expression is distributed in the individual texts. You can also choose which metadata you want to display in the concordance.

- Where can I read more about this method?
Concordancer: link to LDACA resource? https://www.atap.edu.au/text-analysis/methods/

- Is there a notebook version?
Yes, there is a Concordancer notebook, but its functionalities differ and it is a proof-of-concept notebook created as a companion to this open access article. It demonstrates how a concordance can be used for analysing dialogic patterns (e.g. social media post and responses to them).
https://github.com/Australian-Text-Analytics-Platform/atap_widgets (scroll down to Standalone tools)

- Where can I get help?
Please use the embedded feedback button at the bottom left of the interface to get in touch with the developer team in the Sydney Informatics Hub.