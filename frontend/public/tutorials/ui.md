<!-- markdownlint-disable MD033 MD041 -->

[← Back to tutorial index](./index.md)

<h1 id="help-ui-overview">User Interface Overview</h1>

The LDaCA app interface is organised into three columns containing eight main sections. This page describes each section and how they work together.

![LDaCA main app](tutorials/assets/ldaca_main.png)

<h2 id="help-ui-tool-choice">1. Tool Choice</h2>

The left sidebar lists the available tool modules. Click a tool name to switch the main area (section 6) to that tool's interface. The available tools include:

- [**Data Loader**](./data-loader.md) — create or load workspaces and upload data files.
- [**Preprocessing**](./preprocessing.md) — filter, sample, join, stack, find, and create columns.
- [**Token Frequency**](./token-frequency.md) — count and explore the most common terms.
- [**Concordance**](./concordance.md) — inspect search terms in their surrounding context.
- [**Trends and Sequence**](./sequential-analysis.md) — count documents over time or any ordered numeric axis.
- [**Topic Modelling**](./topic-modeling.md) — discover themes using BERTopic.
- [**Quotation Extraction**](./quotation.md) — capture quoted speech with speaker and verb annotations.

The edit icon next to the heading lets you customise which tools appear and in what order.

<h2 id="help-ui-data-selection">2. Data Selection</h2>

Below the tool list, the **Data Blocks** panel shows every data block in the active workspace. Select one or more data blocks here to make them available to the current tool. This is a convenient shortcut for selecting data blocks, equivalent to clicking nodes in the Workspace Graph View (section 4), and is especially useful when the right column is hidden.

- The total count and the number of currently selected data blocks are shown at the top.
- Click a data block to select it. Hold **Shift** (or **⌘** on macOS) to select multiple data blocks when a tool requires more than one (e.g. Join or Stack).
- A blue checkbox indicates the currently selected data block(s).
- Selected data blocks automatically populate the tool interface (section 6) and the Data Viewer (section 5).
- Most tools can only process a limited number of data blocks at a time; by default these are the most recently selected ones.

<h2 id="help-ui-task-centre">3. Task Centre</h2>

The **Tasks** panel sits below data selection and tracks time-consuming background operations such as topic modelling or large data transformations.

- A green indicator means all tasks have completed successfully.
- While a task is running, a progress spinner and status message appear.
- Click **Clear** to dismiss completed task notifications.
- **Live updates** keeps the panel refreshed automatically so you can continue working while tasks run in the background.

<h2 id="help-ui-workspace-graph-view">4. Workspace Graph View</h2>

**Note:** The entire right column (Workspace Graph View and Data Viewer) can be collapsed to save screen space. Click the top-right arrow button to hide or show the right pane.

The **Workspace Graph View** occupies the top-right area and visualises how data blocks relate to each other. Every data block is a node and every derivation (filter, join, sample, etc.) draws an edge from parent to child.

- Click a node to select that data block across the entire interface.
- Shift/⌘-click nodes to multi-select for tools that require two data blocks.
- Use **Rename** to rename the active workspace.
- Use **Save** to persist the workspace to disk. The workspace is also auto-saved on any change; this button is for peace of mind.
- Pan and zoom the graph to navigate large workspaces.
- Asterisked nodes indicate the currently selected data blocks.

<h2 id="help-ui-data-viewer">5. Data Viewer</h2>

The **Data Viewer** fills the bottom-right area and displays the contents of selected data blocks in a tabular format.

- Tabs along the top let you switch between multiple selected data blocks.
- The **Data View** sub-tab shows the raw table; the **Rename** button lets you rename the data block.
- **Undo** and **Redo** buttons revert or reapply the most recent in-place operation (e.g. rename a column, change a data type, create or delete a column).
- Each column header shows the column name and its data type (e.g. `datetime`, `string`). Click the settings icon on a column to rename it or change its data type — for example, to convert a date column loaded as string to a `datetime` type.
- The table is paginated — use the controls at the bottom to navigate through large data blocks.
- Scroll vertically with your mouse scroll wheel. Hold **Shift** to scroll horizontally.

<h2 id="help-ui-tool-interface">6. Tool Interface</h2>

The centre column is the main working area and shows the interface of whichever tool is selected in section 1. Each tool provides its own configuration options, previews, and action buttons.

- The tool name and a short description appear at the top.
- Sub-tabs (e.g. Filter, Sample, Join, Stack, Find, Create in Preprocessing) let you switch between related operations within the same tool.
- Most tools follow a common workflow: configure parameters → review a preview → click an action button (such as **Add to Workspace**) to produce a new data block.
- Help icons (**?**) are placed next to individual controls and link directly to the relevant section of the tutorial.

<h2 id="help-ui-working-directory">7. Working Directory</h2>

The **Working Directory** indicator at the bottom of the left sidebar shows the local file-system path where workspace data is stored.

- Click the edit icon to change the directory.
- All workspaces, uploaded files, and exported outputs are stored under this path.
- The default location is `~/Documents/ldaca`.

<h2 id="help-ui-help-feedback">8. Help and Feedback</h2>

The **Tutorial** and **Feedback** buttons at the very bottom of the left sidebar provide quick access to assistance.

- **Tutorial** opens the built-in tutorial in a floating window (the one you are currently reading). Clicking any **?** help icon in the interface scrolls the tutorial to the relevant section.
- **Feedback** opens a form where you can report bugs, request features, or ask questions. Your feedback goes directly to the developer team. Please do not include any confidential information.

[← Back to tutorial index](./index.md)
