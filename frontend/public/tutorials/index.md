<!-- markdownlint-disable MD033 -->

<h1 id="help-tutorial-index">LDaCA Text Analytic webApp Tutorial</h1>

<p align="center">
  <img src="/LDaCA_logo_Dark.png" alt="LDaCA" width="360" />
</p>

Welcome to the LDaCA WebApp, your innovative solution for text analysis in research projects. This guide is designed to support new users as they begin their journey with the LDaCA text analytic tools, providing clear instructions, practical examples, and inspiration for leveraging the app’s powerful tools. Whether you are new to text analysis or an experienced researcher, this document will help you understand the installation process, the user interface, the core concepts behind the LDaCA’s interoperable tools, and how to achieve meaningful outcomes from your analysis.

## Overview

The LDaCA WebApp offers an interface that prioritizes ease of use and efficient navigation. The main user interface includes the following main sections, systematically presented in three primary columns.

![LDaCA main webApp](tutorials/assets/ldaca_main.png)

1.	Tool Choice: Choose and customise which tool module to use.
2.	Data Selection: Select the data block to be analysed.
3.	Task Centre: Show progress of time-consuming tasks.
4.	Workspace Graph View: Manage all processible and produced data blocks.
5.	Data Viewer: View selected data block(s) as table.
6.	Tool Interface: The main interface of the selected analytic tool.
7.	Working Directory: Set the local directory where the data are saved.
8.	Help and Feedback: When you encounter problems.

For detailed explanation of how each of the above sections work, please refer to [User Interface Overview](./ui.md).


## Concept: How the Tools Interoperate
The LDaCA suite of tools is designed to work together seamlessly, allowing you to conduct comprehensive text analyses. Here’s how the components interact:
- **Data block**: Tabular data consists of at least one column of analysable textual contents. Each row represents a unit of text (document, post, comment, speech etc.) and its associated metadata in columns. A data block can be viewed as a collection of texts with various types of metadata.
- **Workspace**: A set of data blocks that can be processed, analysed and derived from each other. The workspace is a virtual space where the user uploads, processes and manipulates all relevant data blocks to a project or task. The workspace is visualised as a graph of interconnecting data blocks, where the links indicates how new data blocks are derived from their parent data blocks through various operations. The user can select, rename, delete or clone the data blocks from the workspace manager.

The data block is the fundamental analytic unit for all LDaCA tools, serves as both input and output so that the result of one tool can be processed by any other tool seamlessly. 
The text corpus and metadata can be uploaded to the webApp then loaded as a data block to an active workspace.
Most operations (filtering, sampling, joining, stacking, detaching etc.) on a data block derives a new data block in the workspace, and 

- Data Loader: Upload your text files and load  the text corpus (e.g., interview transcripts, articles) into a project workspace.
- Preprocessing: Use built-in cleaning tools to prepare your text, including removal of stopwords, stemming, and normalization.
- Analysis Modules: Select from available tools — such as frequency analysis, quotation extractor, topic modeling or concordance analysis — to process your data.
-	Results Integration: Combine the findings from different modules to gain holistic insights, e.g., linking topics to historical trends.
- Export & Share: Export your results in various formats (CSV, image or a whole zip archived workspace) and share with your collaborators.

## How to use the help icons

- Click a **?** icon next to a control to jump straight to its explanation.
- The tutorial will scroll to that section and briefly highlight it.
- If a help link is missing, you will see a small sonar-style toast and the tutorial will stay closed.

## Quick start (first session)

1. **Create or load a workspace** so your work is saved together.
2. **Upload files** or import sample data to explore quickly.
3. **Clean and join** your data if needed.
4. **Run analyses** like token frequency, concordance, or topic modeling.
5. **Export** results for sharing or downstream work.

> **Placeholder (image):** Add a hero screenshot of the workspace with highlighted side panels.

## Tutorial sections

- [User Interface Overview](./ui.md) — learn what each section of the main screen does.
- [Data loader](./data-loader.md) — create workspaces and upload data.
- [Data Preprocessing](./preprocessing.md) — filter, slice, join, stack, and create columns.
- [Token frequency](./token-frequency.md) — count and explore common terms.
- [Concordance](./concordance.md) — inspect terms in context.
- [Topic modeling](./topic-modeling.md) — discover themes with BERTopic.
- [Sequential analysis](./sequential-analysis.md) — analyze sequences over time.
- [Quotation extraction](./quotation.md) — capture quoted segments with context.
- [Export](./export.md) — download tables or reports.

## Questions to check your understanding

**Q: What is a workspace?**

A workspace is a saved container for your datasets, settings, and analysis outputs. Think of it as a project folder inside the app.

**Q: Why are there separate tutorial pages?**

Each page focuses on a single area so you can learn in small steps and jump directly from a help icon.
