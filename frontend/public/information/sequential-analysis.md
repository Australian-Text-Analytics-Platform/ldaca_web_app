<!-- markdownlint-disable MD033 -->

<h2 id="info-sequential-analysis-overview">About Trends and Sequence</h2>

- What is this?

If your text collection includes dates as metadata, this tool allows you to see how many texts were created on each date, creating a timeline visualisation. You can also do a sequential analysis for texts produced by a particular group of speakers/authors if you have additional metadata – for example showing how the texts of younger vs older speakers are distributed over time. You can include up to 3 different metadata categories in this timeline visualisation. Please note the total number of groups is the product of all selected categories, therefore this can get overwhelmingly large for the visualisation.

You can also use this tool to identify how one or more particular words occur across time, as long as the words are extracted as a metadata column (e.g. using the Concordance tab).

Besides datetime data, the user can also choose to use any numeric data as the X axis, this can be used to show different statistical information. For example, if the word count of documents is available as a metadata, selecting word count as X-axis generates histogram of the text lengths in a collection.


- What do I need to know before using this?
Your textual data should be consistently encoded (UTF8) and should not contain any xml tags. If necessary, you can use the Preprocessing tab to remove any content within angle brackets. Search for this regex pattern <[^>]+> in the ‘document’ text column of your collection and replace with empty string.

You need to make sure that the column that includes the date is correctly classified in the Data Loader (not as string, but as datetime, integer or float). You can auto-convert this in the Data Loader. For additional metadata (e.g. gender, age, political party) it is a good idea to have these metadata converted in the Data Loader as categorical.

For visualising words on the timeline: You first have to create a Concordance and add this as a data block to your workspace. When you do this, make sure you include the date and any other metadata that you need for your analysis. You then use the Concordance data block as source when doing the Trends and Sequence analysis and you add CONC_matched_text (string) as a Group By column. This will show you how the concordance search term occurs over time. Certain preprocess step may be required to eliminate the case differences in extracted data.

- Can I change any of the settings/parameters?
You can change the frequency (e.g. daily vs monthly), you can change the chart type for the visualisation, and you can add parameters (based on metadata) for the comparison (Add Group). You can change which parameters are visible and which are not visible in the timeline. When numerical data is selected, you can decide the interval where the origin to start for the X-axis (not necessarily starting from Zero).

- Is there a notebook version?
There was a preliminary notebook version of this concept on this [GitHub Repo](https://github.com/Australian-Text-Analytics-Platform/atap-corpus-timeline), however this visualisation works the best with various filtering/extracting/creating tools as an integration.

- Where can I get help?
Please use the embedded feedback button at the bottom left of the interface to get in touch with the developer team in the Sydney Informatics Hub.
