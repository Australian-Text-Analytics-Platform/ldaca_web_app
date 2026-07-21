# LDaCA Web App Written Overview

**Scope statement:** This written guide introduces the main UI areas without
starting a Guided Tour or covering backend internals.

## Step 1 — Understand the layout

**Question:** *What are the main UI regions?*

**Answer:**

- **Left sidebar** for tabs and tasks.
- **Center panel** for the active feature (data loader, analysis tabs).
- **Right panel** for the workspace graph and data table.

## Step 2 — Workspaces and Data Blocks

**Question:** *What is a workspace in the UI?*

**Answer:** A workspace is a project container. Data Blocks inside it represent
datasets and analysis results.

## Step 3 — Data Loader tab

**Question:** *How do I bring data into the app?*

**Answer:** Use the Data Loader to create or load a workspace, import sample
data or upload your own files, then add a file to the workspace as a Data
Block. First-time Contextual Hints introduce these steps one at a time. Each
hint can also disable Contextual Hints after confirmation; turn them back on or
reset their history from **Settings → Guidance**.

## Step 4 — Analysis tabs

**Question:** *Where do analysis results show up?*

**Answer:** Select nodes, run an analysis tab (token frequency, concordance, etc.), and view results in the center panel.

## Step 5 — Workspace graph and data view

**Question:** *How do I inspect data?*

**Answer:** Select a node in the graph to view its table in the lower data view section.

## Step 6 — Provider credentials in Settings

**Question:** *Where do I configure AI and LDaCA Data Portal credentials?*

**Answer:** Use **Settings → AI** and **Settings → Portal**. Credential
inputs are always blank and write-only: **Save** replaces a value and **Clear**
removes it. When Wordflow runs locally in single-user mode, the local backend
stores credentials for the fixed Root User. In hosted multi-user mode,
credentials stay in this browser for the signed-in account, remain after
logout, and must be entered again in another browser or device.

## Recap

**Question:** *What should I read after the tour?*

**Answer:** Open **Help** in the sidebar for feature guides. Guided Tour
launchers appear there only when a tour is available.
