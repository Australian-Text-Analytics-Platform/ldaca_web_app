/**
 * Builds the sampled plain text that TokenizerModelSelector uses for language
 * detection without coupling the component to node-data response row shapes.
 * Used by: TokenizerModelSelector and tokenizer selector unit tests because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules.
 */
export function collectDocumentColumnText(
  rows: Array<Record<string, unknown>> | undefined,
  column: string,
): string {
  if (!rows?.length || !column) return '';
  return rows
    .map((row) => row[column])
    .filter((value) => value != null)
    .map((value) => String(value).trim())
    .filter(Boolean)
    .join('\n');
}