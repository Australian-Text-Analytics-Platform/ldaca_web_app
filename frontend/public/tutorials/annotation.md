<!-- markdownlint-disable MD033 MD041 -->

[← Back to tutorial index](./index.md)
<h1 id="help-annotation-section">Annotation tutorial</h1>

Use Annotation to apply one of the codes in a Codebook to each source row,
either directly or with predictions from a configured AI provider.

<h2 id="help-annotation-setup">Set up the source and Codebook</h2>

1. Under **Annotation Data Block**, add one Data Block and choose the text
   column.
2. Select an existing string annotation column, or choose **Start new
   annotation** and create one. This is an immediate Data Block Edit.
3. Under **Codebook**, add a Data Block and map its code and description
   columns. Use **Create New** when you need an empty Codebook, then review and
   edit its rows before labelling.
4. Choose **Manual** or **AI**. The source and Codebook are shared between both
   modes.

<h2 id="help-annotation-manual">Manual workflow</h2>

Choose **Start** to open the annotation table. Select a Codebook value for each
row; each change is written directly to the annotation column as a Data Block
Edit. Start captures the source, annotation column, Codebook mapping, and table
inputs. You can edit the setup as the draft for the next table without changing
the open table. Choose **Close** even if that draft is incomplete; the next
Start captures the new setup. Switching modes hides but does not rewrite the
open Manual snapshot.

Use **Compare To** to add another coder or model. Each comparison starts masked
as `•••` so you can code without seeing how individual rows were coded. Its
header always shows the reliability score (hover or focus it for the confusion
matrix) and the row-filter menu; reveal the column from the eye button to show
its values and difference colours. Removing the filtered column clears the
filter; hiding it does not. Reliability statistics summarize agreement but do
not explain why labels differ.

The funnel button in the annotation column header and in each comparison header
opens a filter menu with two independent conditions: **Differs** and a value
radio (**All rows**, **Has value**, **Empty**). On a comparison column, Differs
keeps rows whose label differs from the annotation column; on the annotation
column it keeps rows that differ from at least one selected comparison column.
Conditions combine, so Differs with Has value narrows further, while Empty greys
out Differs because an empty cell never differs. Only one column carries a filter
at a time; setting a filter on another column replaces it. Filtered rows and
counts are calculated before server pagination. Preview has no row filter
because its rows are chosen by the AI request.

A cell counts as **empty** when it is blank or holds a value that is not a
Codebook class (for example `P` instead of `promise`, or a date pasted by
accident). Such values are still displayed, in muted italics, but they never
count as differences, never contribute to reliability, and match **Empty**
rather than **Has value**. Matching is exact after trimming spaces; `Promise`
is not `promise`. Without a Codebook only the blank rule applies.

Drag the handle under the table to make it taller, up to three quarters of the
window; double-click the handle to reset. The height is shared by Manual,
Preview, and Review in the same tab, and the table scrolls inside its frame
when a page does not fit.

**Compare To** and **Show metadata** are exclusive roles: a selected column is
disabled in the other menu, and **Select all** skips disabled columns. The
active correction column appears in neither menu. Add a correction column when
you want reviewed decisions kept separately, and use metadata columns to retain
useful source context in the table.

<h2 id="help-annotation-ai">AI workflow</h2>

Expand AI settings and choose a named provider configuration and model. Provider
credentials stay in Settings and are attached only when the request is sent.
Create or edit connections under **Settings → AI**. API keys are optional when
saving, but a built-in provider marked **Needs API key** cannot list models,
Preview, or Run All until you add one. Custom endpoints may be keyless. Editing
a key updates future requests; a Run All already queued or running keeps the key
captured when it was submitted.
An **Example Data Block** is optional; if used, choose both its text column and
an existing annotation column containing reviewed labels. Set **Max examples
per class**, then choose **Random**, **First N**, or **Last N**. Random sampling
also accepts a nonnegative seed and defaults to 0. The same Data Block snapshot,
maximum, method, and seed produce the same per-class subset throughout one
Analysis; groups with fewer examples contribute every usable row.

Advanced settings include the instruction prompt, processing mode, batch size,
retry count, temperature, and supported reasoning controls. Defaults are a good
starting point. Change one setting deliberately, because provider capability,
cost, latency, and repeatability vary by model.

<h3 id="help-annotation-preview">Preview</h3>

Choose **Preview** to create an immutable Analysis snapshot and inspect predicted
labels without writing to the annotation column. Page through the predictions,
compare them with existing labels, add corrections if useful, then revise the
Codebook, examples, model, or settings when the errors show a pattern.
The label remains **Preview**, and it becomes available after an
execution-request change. **Run All** compares against its own submitted request.

<h3 id="help-annotation-run-all">Run All and review</h3>

Choose **Run All** only after Preview is satisfactory. Run All executes from the
saved Preview snapshot and writes labels to the selected annotation column. The
Review table reflects the current Data Block and supports the same hidden-first
comparisons, row filters, reliability, metadata, resizable frame, and correction
controls. A reviewed
correction column can also be selected as the Example annotation column for a
later run.

A provider-wide failure is shown in Annotation and Tasks and writes no labels.
When only individual rows cannot fit the provider context or produce a valid
response, successful rows are published and a warning reports failed rows and
batches. Failed rows keep their existing values in **Reprocess all** and remain
blank in **Fill missing**; a successful explicit empty prediction may still
clear a value.

<h2 id="help-annotation-results">Results, Clear Results, and Undo</h2>

**Clear Results** removes the tab's Preview and Run All Analyses and clears its
result state; it does not undo labels already written to the Data Block. Use the
Data Block's session **Undo** action to reverse the latest manual edit, AI write,
or column creation. Undo history lasts only for the current backend Workspace
session.

Preview or Run All locks the parameter panel only while submission or execution
is active. A failed or cancelled root unlocks parameters but disables both
execution actions until Clear Results. Existing tables remain tied to the
request or Manual Start snapshot that produced them while you edit the next
draft.

Before using labels downstream, sample every code, inspect uncertain or costly
errors, and record who or what produced the labels. Treat AI predictions and
agreement scores as evidence for review rather than proof of correctness.

[← Back to tutorial index](./index.md)
