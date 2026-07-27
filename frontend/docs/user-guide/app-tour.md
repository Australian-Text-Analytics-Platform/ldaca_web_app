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
Data Block controls in the main parameter panel. The collapsed **Advanced** row
summarizes the selected provider and model; expanding it presents those two
controls side by side, followed by Prompt and inference controls. **Batch
size** controls how many rows each Run All LLM request contains (20 by default,
up to 100). **Max retries per
batch** defaults to two retries—three attempts in total—and `0` disables
retries. Each attempt has a bounded answer size and is accepted only when the
provider returns one valid label per requested row; invalid large-batch replies
are retried and then split into smaller batches. **Run All processing** defaults
to **Reprocess all rows**; choose **Fill
missing only** to preserve existing labels and send only blank annotation rows.
Preview always processes its requested page, so its page size rather than the
Run All batch-size or processing-mode setting determines the request.

**Run All** processes the complete Data Block and writes the final Annotation
Column in place without applying the correction column. Exhausted batches leave
their target rows blank while successful batches are still written; progress
updates as each batch finishes. Review uses the standard rows-per-page and
numbered pagination controls. Annotation keeps one current task: Run All
replaces Preview, and a later Run All replaces the previous Run All. **Clear
Results** also clears the selected correction-column draft so the next task
starts without inheriting it.

Manual Annotation also provides **Compare To**. Select one or more other label
columns to add them as read-only table columns. Non-string columns are omitted
from this checklist; string and categorical columns remain eligible. At the top, choose
**Percent Agreement**, **Cohen's Kappa** (the default), or **Krippendorff's
Alpha**. Each compared column header shows the selected score with `%`, `κ`, or
`α`; hover or focus the score to inspect the exact confusion-matrix counts.
Preview scores use only the current page, while Manual and Review scores use
the whole Data Block. The same comparison columns and reliability choice remain
selected in all three modes, and each successfully saved Manual label updates
its scores and counts immediately. **Show metadata** is available beside
**Compare To** in Manual, Preview, and Review; its per-Data-Block checklist
selection also remains the same across all three modes. Preview and Review show
a configured correction column by default. Use **Hide correction** or **Show
correction** to change only its table visibility; the selected correction
column and its stored values are left unchanged.

## Recap

**Question:** *What should I read after the tour?*

**Answer:** Open **Help** in the sidebar for feature guides. Guided Tour
launchers appear there only when a tour is available.
