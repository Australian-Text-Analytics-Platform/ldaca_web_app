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