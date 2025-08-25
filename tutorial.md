<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/logo.png" alt="LDaCA Logo" width="300"/>
</p>

# LDaCA Web App Tutorial

Welcome! This guide walks you through the LDaCA web application—from first launch to analysis and export—without assuming any programming background. You’ll learn what Workspaces and Nodes are, how to bring your own files, explore text, filter data, model topics, view timelines, and export results.

---

## 1) Core concepts in simple terms

- Workspace
  - Think of a workspace as a project folder inside the app. It keeps your data files, the steps you take, and the results together. You can check the workspace in the graph view window. ![Graph view window](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/Jai2eY.png)
  - You can have multiple workspaces and switch between them by going to **Data Loader**, and then **Workspace Manager**. ![Workspace list](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/ws_load.gif)

- Node
  - A node is a box in the “graph” that represents a dataset (a table of rows and columns), they could be loaded from files by going to **Data Loader** and then **File Upload** and click **Add to Workspace** or **Create Workspace & Add**. ![File upload](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/file_upload.gif) Or they could also be created from existing nodes by applying transformations or analyses.
  - When you add or transform data, the app creates new nodes and connects them with lines to show “this came from that.” ![join](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/join.gif)
  - You can select nodes to view their data or run analyses. ![data view](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/data_view.gif)

- What powers a node behind the scenes
  - Polars: a high‑performance data table engine (like a faster spreadsheet engine).
  - docframe: built on top of Polars for text analytics; it adds text-aware features such as choosing a “document” column and text operations.
  - docworkspace: manages a network of nodes and the steps between them; it remembers how your results were produced.

- Lazy vs. non‑lazy (you’ll see a “lazy” badge sometimes)
  - Lazy means “don’t compute everything yet—wait until needed.” This makes the app fast, especially with large data. Sometimes the “rows” count shows “?” until the app needs to compute it. ![lazy badge](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/uUQjOb.png)

- Shapes (Rows × Columns)
  - Every node shows a shape like “10 × 5” which means 10 rows and 5 columns. If the rows show “?” for a lazy node, hover or open the data view to let the app calculate it when needed. ![show shape](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/show_shape.gif)

---

## 2) The app layout at a glance

- Header: shows your name (if logged in) and a Logout button. ![header](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/mfFRUu.png) The log out button is designed for multi user environments.
- Left Sidebar: tab buttons (Data Loader, Filter/Slicing, Token Frequency, Topic Modeling, Concordance, Timeline, Export) and a live list of nodes with checkboxes to select them. ![left side bar](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/Po2Uve.png)
- Middle Panel: the main controls for the active tab. ![middle panel](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/8Reyp6.png)
- Right Panel: the Workspace View with two stacked sections:
  - Graph View (top): boxes and lines showing your workflow. ![graph view](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/sBUDUy.png)
  - Data View (bottom): a table view of the selected node’s data. ![data view](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/SZpwpE.png)
- The right panel can be collapsed/expanded and resized vertically inside. ![flexi panels](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/flexi_panels.gif)

---

## 3) Getting started (first run)

- If asked to sign in, use the Google sign‑in button. In single‑user mode you may not see sign‑in.
- The app automatically checks that the backend is ready before the UI loads. ![loading page](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/EcgIcE.png)
- Workspace controls (top of right panel) show the current workspace name. You can rename, Save, Save As, Download or Unload it. ![workspace controls](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/ws_operations.gif)

---

## 4) Data Loader: bring files in and manage workspaces

Open the “Data Loader” tab.

- Upload files
  - "Drag & drop files onto the list below to upload, or browse"
  - Supported types include CSV, ~~JSON, TXT, TSV, Parquet, and Arrow IPC~~ (not implemented yet).
  - Files are labeled SAMPLE (provided by the app) or USER (your uploads).

![upload panel](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/joiWQ9.png)

- Create a workspace and add a file as a node
  - If no workspace is active, type a workspace name (optional) and click “Create Workspace” on any file. The app creates the workspace, then lets you choose how to add the file. ![create button](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/Q5Pxek.png) ![load panel](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/MpvqU3.png)
  - For text analytics, pick DocDataFrame/DocLazyFrame and choose the “document” column (the column that contains text). For general tables, pick DataFrame/LazyFrame.

- Preview, download, and delete files
  - Click a file row to preview it. ![file preview](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/file_preview.gif)
  - Use the “Download” button to save a copy. ![download button](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/qCVe2D.png)
  - For your own files (USER), use “Delete” to remove them. ![delete button](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/1w7UL6.png)

- Workspace Manager
  - See all workspaces, Load one, Download it as JSON, or Delete it. ![ws overview](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/x2a5e8.png)
  - Import a workspace JSON by dragging it onto the list or clicking browse — the workspace list itself is the drop target.
  - Each workspace item shows basic info: node count, file size, created at, and last modified. ![ws info](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/Ayh5n5.png)
  - Action buttons (Load, Download, Delete).
  - “Unload Current Workspace” removes it from memory after saving without deleting from disk.

Tips:

- Lazy choices are better, especially for large data; they compute only when needed.
- Doc types (DocDataFrame/DocLazyFrame) are ideal for text analytics.

---

## 5) Workspace View: graph and data

- Graph View (top)
  - Each box is a node. Click a node to select it; click again to toggle selection. ![node select](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/node_select.gif)
  - Use the controls in the top‑right of the graph to show/hide the overview map and “Deselect all.”
  - Drag nodes to arrange them; the layout is automatically computed but you can reposition for your view. ![graph op](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/graph_op_1.gif)

- Node menu (three dots on a node)
  - Save: placeholder for saving node data (when enabled by your setup).
  - Rename: change the node’s label.
  - Convert types: switch between Polars and docframe flavors (DataFrame/LazyFrame vs. DocDataFrame/DocLazyFrame). Doc types prompt for the document column.
  - Reset document column: choose a different text column for doc nodes.
  - Delete: remove the node from the workspace.

![node dropdown](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/NBRVi3.png)

- Data View (bottom)
  - Shows a table for the selected node.
  - Pagination controls and page size let you explore large tables.
  - Change a column’s type with the dropdown above each column (e.g., string → datetime). If converting to datetime, a small format helper appears. ![data view op](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/data_view_op.gif)

Tip:

- If a node’s rows show “?” (lazy), hovering or opening the data view allows the app to calculate the actual count.

---

## 6) Filter/Slicing: create a filtered node

Open the “Filter/Slicing” tab.

- Choose a node (select it in the graph first).
- Build conditions: pick a column, an operator (e.g., Equals, Contains, Before), and enter a value. ![filter builder](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/2GGlsK.png)
- For dates/times, you can type an ISO‑like timestamp or use a small date‑time helper. ![datetime picker](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/6URENX.png)
- Choose whether conditions are combined with AND or OR. ![and or](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/Uu0vQa.png)
- Provide a new node name (optional) and Apply. The app creates a new node connected to the original. ![new cond create](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/AwEFs4.png)

---

## 7) Token Frequency: top words per corpus (compare up to two)

Open the “Token Frequency” tab.

- Select up to two nodes in the sidebar (checkboxes) and pick the text column for each (if the nodes are of Doc types (DocDataFrame and DocLazyFrame), then the document column will be automatically selected). ![select nodes for token freq](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/blS4WX.png)
- Optional: add stop words (words to ignore such as “the,” “and”). You can auto‑fill common English stop words. ![stop words](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/jXNEgf.png)
- Click “Calculate Token Frequencies.”
- View a word cloud per node and a bar chart list of top tokens. ![freq comp](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/xCpfEK.png)
- Click a token to jump to the Concordance tab and see the token in context. Right‑click a token to add it to stop words. ![tok op](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/tok_freq_op.gif)

Note:

- Comparison is limited to two nodes side‑by‑side.

---

## 8) Concordance: search a word/phrase in context (compare up to two)

Open the “Concordance” tab.

- Select up to two nodes and their text columns.
- Enter a word (or regex) and choose how many words to show on the left and right.
- Optionally enable “case sensitive” or regular expression mode.
- Run the search to see results per node, or switch to a combined table view.
- Sort results, change page size, and navigate pages.
- Click a result to view more detail (when detail is available in your setup).

![concord op](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/concord_op.gif)

Tip:

- The Token Frequency tab can send you here automatically when you click a token.

---

## 9) Topic Modeling (BERTopic): find themes

Open the “Topic Modeling” tab.

- Select one or two nodes and choose each node’s text column.
- Pick “Min Topic Size” (smaller for many tiny topics; larger for fewer, bigger topics).
- Optionally enable “c‑TF‑IDF embeddings.”
- Run topic modeling. You’ll see bubbles (topics) in a chart; bubble size indicates topic size.
- With two corpora selected, colors blend to show proportion from each corpus.
- Hover a bubble to see a tooltip with top words; topic cards summarize the first topics below the chart.

![topic modeling](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/4Zk7wJ.png)

Note:

- Comparison is currently limited to two nodes.

---

## 10) Timeline: counts over time for one node

Open the “Timeline” tab.

- Select a node (single).
- Choose a time column (the app suggests a likely one) and optional “Group By” columns.
- Pick a frequency (daily/weekly/monthly/yearly) and a chart type (line/bar/area).
- Run analysis to view counts over time. The legend shows each group if you grouped by columns.

![timeline](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/pZGnUz.png)


---

## 11) Export: download selected node data

Open the “Export” tab.

- Select one or more nodes via the sidebar checkboxes.
- Choose a format: CSV, JSON, NDJSON, Parquet, or Arrow IPC.
- Click Export. If you selected multiple nodes, you’ll receive a ZIP file containing each.

---

## 12) Joins (two nodes) in the Data View

- If you select exactly two nodes, the Data View shows a simple joining interface.
- Choose the join columns for each node and a join type. Join types use Polars' exact values: inner, left, right, full, semi, anti, cross. ![join interface](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/dkQNcU.png)
- The app creates a new node with the joined result.

---

## 13) Tips, best practices, and where files live

- Start with DocDataFrame/DocLazyFrame if your data has a text column you want to analyze.
- Use LazyFrame/DocLazyFrame for large files; switch to non‑lazy only when needed.
- Keep workspaces tidy: rename nodes meaningfully after major steps.

Feedback:

- Use the “Feedback” button at the bottom of the sidebar to send comments or report an issue. ![feedback button](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/UcGzHC.png)

![feedback modal](https://cdn.jsdelivr.net/gh/AlexDrBanana/images@main/uPic/UO5emc.png)

---

## 15) Glossary

- Workspace: Your project container.
- Node: A dataset/result box in the workflow graph.
- Polars: Fast engine powering tables.
- docframe: Text‑analytics layer built on Polars (adds document‑aware features).
- docworkspace: Manages the node graph and how steps connect.
- Lazy: Compute only when needed (faster for big data).
- Shape: Rows × Columns for a node’s data table.

---

That’s it—you’re ready to explore text datasets, compare corpora, search in context, model topics, plot timelines, and export results in the LDaCA web app.
