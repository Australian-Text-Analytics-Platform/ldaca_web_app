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
- [**Topic Modelling**](./topic-modeling.md) — discover themes with native semantic clustering.
- [**Quotation Extraction**](./quotation.md) — capture quoted speech with speaker and verb annotations.
- [**Annotation**](./annotation.md) — label text manually or with a configured AI provider.
- [**Export**](./export.md) — download selected Data Blocks or a Workspace archive.

The edit icon next to the heading lets you customise which tools appear.

<h2 id="help-ui-data-selection">2. Data Selection</h2>

Below the tool list, the **Data Blocks** panel shows every data block in the active workspace. It is both a quick selector and a live indicator of what is selected in the [Workspace Graph View](#help-ui-workspace-graph-view) (section 4) — selecting a block here is equivalent to clicking the corresponding node in the graph, and the two panels always stay in sync. It is especially useful when the right column is hidden.

- The total count and the number of currently selected data blocks are shown at the top.
- Click a data block to toggle its selection. Click again to deselect it. For tools that require more than one data block (e.g. Join or Stack), simply click each block in turn to build up a multi-selection.
- A filled circular checkbox indicates a selected data block; an empty circle indicates an unselected one.
- The list is sorted so that selected blocks always appear at the top, ordered by most recently selected first. Unselected blocks follow in alphabetical order.
- Selected data blocks automatically populate the tool interface (section 6) and the Data Viewer (section 5).
- Most tools can only process a limited number of data blocks at a time; by default these are the most recently selected ones.

<h2 id="help-ui-task-centre">3. Task Centre</h2>

The **Tasks** panel sits below data selection and projects background Analyses
from the active Workspace together with your retained User File Imports.

- Analysis rows show progress and status only. Use the Analysis's owning Tab to
  cancel, clear, or re-run it.
- Queued and running User File Imports show **Stop**. The row remains visible if
  cancellation fails so you can try again.
- Successful, failed, and cancelled User File Imports remain available until
  you click **Clear**. Clearing the task removes its retained history record,
  not any files it successfully imported.
- **Live updates** keeps the panel refreshed automatically so you can continue
  working while tasks run in the background.

<h2 id="help-ui-workspace-graph-view">4. Workspace Graph View</h2>

**Note:** The entire right column (Workspace Graph View and Data Viewer) can be collapsed to save screen space. Click the top-right arrow button to hide or show the right pane.

The **Workspace Graph View** occupies the top-right area and visualises Data Block creation lineage. Every Data Block is a node, and creating a Derived Data Block draws an edge from parent to child. Updating an existing Data Block does not change the graph.

- Click a node to select that data block across the entire interface. Click it again to deselect. Selections made here are reflected immediately in the Data Blocks panel (section 2) and vice versa.
- Hover a Data Block and open its settings menu to **Rename**, **Clone**, **Undo**, **Redo**, or **Delete** it. Undo and Redo availability comes from that Data Block's current backend session history.
- Use **Rename** to rename the active workspace.
- Pan and zoom the graph with your mouse to navigate large workspaces. A control panel sits at the top-right corner of the graph with the following buttons:
  - <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="13" height="13" style="display:inline;vertical-align:text-bottom"><path d="M32 18.133H18.133V32h-4.266V18.133H0v-4.266h13.867V0h4.266v13.867H32z"/></svg> **Zoom in** — increases the zoom level.
  - <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 5" width="13" height="2" style="display:inline;vertical-align:middle"><path d="M0 0h32v4.2H0z"/></svg> **Zoom out** — decreases the zoom level.
  - <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 30" width="13" height="12" style="display:inline;vertical-align:text-bottom"><path d="M3.692 4.63c0-.53.4-.938.939-.938h5.215V0H4.631A4.63 4.63 0 0 0 0 4.63v5.216h3.692V4.631zM27.354 0h-5.2v3.692h5.215c.53 0 .938.4.938.939v5.215H32V4.631A4.63 4.63 0 0 0 27.354 0zm.954 24.746c0 .53-.4.938-.939.938h-5.215V29.338h5.215A4.63 4.63 0 0 0 32 24.708v-5.215h-3.692v5.253zm-23.677.938a.939.939 0 0 1-.939-.938v-5.253H0v5.215A4.63 4.63 0 0 0 4.631 30h5.215v-3.692H4.631v.376z"/></svg> **Zoom to fit** — resets the view so all nodes are visible at once.
  - <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25 32" width="10" height="13" style="display:inline;vertical-align:text-bottom"><path d="M21.333 10.667H19.81V7.619C19.81 3.429 16.38 0 12.19 0 8 0 4.571 3.429 4.571 7.619v3.048H3.048A3.048 3.048 0 0 0 0 13.714v15.238A3.048 3.048 0 0 0 3.048 32h18.285a3.048 3.048 0 0 0 3.048-3.048V13.714a3.048 3.048 0 0 0-3.048-3.047zM12.19 24.533a3.048 3.048 0 1 1 0-6.095 3.048 3.048 0 0 1 0 6.095zm4.724-13.866H7.467V7.619a4.723 4.723 0 0 1 9.447 0v3.048z"/></svg> **Lock** — toggles whether nodes can be dragged. When locked, node positions are fixed; panning and zooming still work.
  - **□ / ▣ Overview** — toggles a minimap in the bottom-right corner of the graph, giving a bird's-eye view of the full workspace layout. Click again to hide it.
  - **⊘ Clear selection** — deselects all currently selected data blocks at once. Greyed out when nothing is selected.
- Asterisked nodes indicate the currently selected data blocks.

<h2 id="help-ui-data-viewer">5. Data Viewer</h2>

The **Data Viewer** fills the bottom-right area and displays the contents of selected data blocks in a tabular format.

- Tabs along the top let you switch between multiple selected data blocks.
- The **Data View** sub-tab shows the raw table; the **Rename** button lets you rename the data block.
- **Undo** and **Redo** revert or reapply the selected Data Block's most recent plan edit. The same actions are available in the graph Data Block menu. History is independent per Data Block, stores at most 50 plans, and lasts only while the Workspace remains open in the backend process. Closing and reopening preserves the latest data but clears both buttons.
- Each column header shows the column name and its data type (e.g. `datetime`, `string`). Click the settings icon on a column to rename or delete it; use the data-type menu to convert its type. These operations update the selected Data Block without creating a new one. When converting, the app attempts to guess the date format automatically. This works for many common formats but can fail or produce incorrect results when the format is ambiguous (e.g. `01/02/03` could be read as DD/MM/YY, MM/DD/YY, or YY/MM/DD). If the conversion fails or the dates look wrong, use the **Format** field to specify the format explicitly using [Python strftime/strptime codes](https://docs.python.org/3/library/datetime.html#strftime-and-strptime-format-codes). Common examples:
  - `%Y-%m-%d` → `2025-05-06`
  - `%d/%m/%Y` → `06/05/2025`
  - `%m/%d/%Y` → `05/06/2025`
  - `%Y-%m-%dT%H:%M:%S` → `2025-05-06T14:30:00` (ISO 8601)
  - `%d %b %Y` → `06 May 2025`
  - `%B %d, %Y` → `May 06, 2025`
- Click any row to open the **Row Details** panel, which displays the full contents of that row in a readable layout. The <a href="tutorials/assets/ui/row_details.png" target="_blank">row details</a> panel has two sections:
  - **Document** — shows the full text of the data block's designated document column (the column marked as the primary text when the data was loaded, e.g. the column named `text`, `document`, or `doc`). The section heading displays the column name, e.g. *Document: text*. If no document column has been configured for the data block, this section is omitted.
  - **Metadata** — shows all remaining columns as a two-column key/value table, making it easy to inspect structured fields such as speaker, date, or source alongside the document text.
- The table is paginated — use the controls at the bottom to navigate through large data blocks.
- Scroll vertically with your mouse scroll wheel. Hold **Shift** to scroll horizontally.

<h2 id="help-ui-tool-interface">6. Tool Interface</h2>

The centre column is the main working area and shows the interface of whichever tool is selected in section 1. Each tool provides its own configuration options, previews, and action buttons.

- The tool name and a short description appear at the top.
- Sub-tabs (e.g. Filter, Sample, Join, Stack, Find, Create in Preprocessing) let you switch between related operations within the same tool.
- Most tools follow a common workflow: configure parameters → review a preview → choose whether to create or update when offered → click **Create Data Block** or **Update Data Block**. Filter, Find, Create, and Expression offer both modes and default to creating a new block. Sample, Join, and Stack are create-only.
- Help icons (**?**) are placed next to individual controls and link directly to the relevant written Help section.

<h2 id="help-ui-working-directory">7. Working Directory</h2>

The **Working Directory** indicator at the bottom of the left sidebar shows the local file-system path where workspace data is stored.

- Click the edit icon to change the directory.
- All workspaces, uploaded files, and exported outputs are stored under this path.
- The default location is `~/Documents/ldaca`. This applies when running the app locally — via self-hosting, the Tauri desktop app, or UVX.
- This section is not available in multi-user mode, where storage is managed server-side.

<h2 id="help-ui-help-feedback">8. Help and Feedback</h2>

The **Help** and **Feedback** buttons at the very bottom of the left sidebar provide quick access to assistance.

- **Help** opens the built-in written guides in a floating window (the one you are currently reading). Clicking any **?** icon scrolls Help to the relevant section.
- **Feedback** opens a form where you can report bugs, request features, or ask questions. Your feedback goes directly to the developer team. Please do not include any confidential information.
<span id="help-ui-hint-system"></span>
- Each of the nine functions can show brief **Contextual Hints** as you reach
  useful milestones. Several hints may form a progressive sequence, but each
  is acknowledged independently. Choose **Got it** or press **Enter** to
  acknowledge the current version and continue to another milestone already
  reached.
- Choose **Not now** or press **Escape** to pause hints for the current function
  visit without acknowledging anything. Switching Analysis Tabs does not
  resume them; leave the function and return to retry the earliest eligible
  unacknowledged hint.
- Contextual Hints can be disabled under **Settings → Guidance**. The same page
  can reset acknowledgment history for the current user, causing eligible hint
  versions to appear again on this device.
- A replayable **Guided Tour** is shown in Help only when one is available. A
  tour is started deliberately and is unaffected by the Contextual Hint switch.

[← Back to tutorial index](./index.md)
