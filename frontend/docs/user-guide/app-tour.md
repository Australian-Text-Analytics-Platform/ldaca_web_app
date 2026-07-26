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

## Step 6 — Annotation providers and Data Portal credentials

**Question:** *Where do I configure AI and LDaCA Data Portal credentials?*

**Answer:** Use **Settings → AI** to add any number of named Annotation Provider
Configurations. Choose OpenRouter, OpenAI, Anthropic, Google, or a Custom
OpenAI-compatible base URL; built-ins require an API key and Custom may be
keyless. Duplicate names are allowed, so names such as `OpenRouter-personal`
and `OpenRouter-org` help distinguish multiple keys. Rename or delete entries
from the ordered list; changing provider type, URL, or credential means adding
a replacement and deleting the old entry.

The Annotation provider dropdown shows only configured entries and keeps **Add
Provider** at the bottom. Model discovery is attempted for Custom entries, but
you can type a model name when discovery fails. **Settings → Portal** manages
the independent Data Portal token. When Wordflow runs locally in single-user
mode, the local backend stores configurations for the fixed Root User. In
hosted multi-user mode, configurations and secrets stay in this browser for the
signed-in account, remain after logout, and must be entered again in another
browser or device.

## Step 7 — Preview and review AI Annotation

**Question:** *How do I review and correct AI annotations?*

**Answer:** In the Annotation parameter panel, choose an existing **User
Correction Column** or add one. Preview shows source text, the fresh prediction,
an arrow, and the correction column separately. Correction choices are written
to that Data Block column immediately, while predictions remain an unwritten
preview. **Use the correction column as the example** fills the optional Example
Data Block controls; Example, Prompt, and inference controls are grouped under
the collapsed **Advanced** section.

**Run All** processes the complete Data Block and writes the final Annotation
Column in place. Review uses the standard rows-per-page and numbered pagination
controls. **Clear Results** also clears the selected correction-column draft so
the next task starts without inheriting it.

## Recap

**Question:** *What should I read after the tour?*

**Answer:** Open **Help** in the sidebar for feature guides. Guided Tour
launchers appear there only when a tour is available.
