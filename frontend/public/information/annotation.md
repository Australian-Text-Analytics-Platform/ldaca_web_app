<!-- markdownlint-disable MD033 -->

<h2 id="info-annotation-overview">About Annotation</h2>

Annotation assigns a controlled label to each text row. Use it to build reviewed
training data, apply a Codebook consistently, compare coders or models, and keep
the labels beside the source text in the same Data Block.

Wordflow supports two workflows:

- **Manual** annotation opens an editable table and saves each label as a Data
  Block Edit.
- **AI** annotation uses a configured provider and model. Preview predicts
  labels without writing them; Run All writes labels to the selected annotation
  column.

Both workflows use one Annotation Data Block, its text and annotation columns,
and one Codebook Data Block containing allowed codes and descriptions. An
optional Example Data Block can supply reviewed examples to AI runs.

AI output is a proposal, not ground truth. Review differences and corrections,
check ambiguous or underrepresented codes, and interpret reliability measures
in the context of the task. Provider calls may incur cost and send the selected
text, Codebook, prompt, and examples to the configured service.

Manual edits, AI Run All writes, and created correction columns participate in
the Data Block's session Undo history. Preview results and Analyses can instead
be removed with **Clear Results**.
