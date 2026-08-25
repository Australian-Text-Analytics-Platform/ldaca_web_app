import React from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// ---- Public types ----

interface RowDetailCustomization {
  /** Label shown in the dialog title parentheses, e.g. "Concordance" */
  label?: string;
  /** Key-value pairs shown in the metadata grid below the title */
  summaryFields?: {
    label: string;
    value: React.ReactNode;
    highlight?: boolean;
  }[];
  /**
   * Custom renderer for the full-text section.
   * Receives the raw text and the full row record.
   * Return `null` to hide the document section entirely.
   */
  renderDocumentText?: (text: string, record: Record<string, unknown>) => React.ReactNode;
}

export interface RowDetailPayload {
  /** The clicked row (all fields) */
  record: Record<string, unknown>;
  /** The text column key whose content is shown as the document body */
  textColumn?: string;
  /** Pre-resolved full text (if the text column maps to a different key) */
  fullText?: string;
  /** Columns to exclude from the metadata table (e.g. generated columns) */
  excludeMetadataColumns?: string[];
}

export interface RowDetailPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payload: RowDetailPayload | null;
  customization?: RowDetailCustomization;
}

// ---- Helpers ----

/**
 * Converts arbitrary row metadata into displayable strings for the detail dialog
 * while preserving object structure for the preformatted metadata table.
 * Called by: RowDetailPanel metadata table rendering.
 */
const formatMetadataValue = (value: unknown): string => {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- value is a non-object primitive after the guards above; String() never yields '[object Object]'
  return String(value);
};

// ---- Component ----

/**
 * Opens the shared row-detail dialog used by analysis tables to inspect full
 * document text, custom summary fields, and remaining row metadata.
 * Used by: concordance and quotation result row detail flows.
 */
export function RowDetailPanel({
  open,
  onOpenChange,
  payload,
  customization,
}: RowDetailPanelProps) {
  if (!payload) return null;

  const { record, textColumn, fullText, excludeMetadataColumns } = payload;
  const excludeSet = new Set(excludeMetadataColumns ?? []);
  if (textColumn) excludeSet.add(textColumn);

  const rawText =
    fullText ??
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- text column holds document text (string content); explicit String() guards against non-string cells
    (textColumn && record[textColumn] != null ? String(record[textColumn]) : undefined);

  const titleSuffix = customization?.label ? ` (${customization.label})` : '';

  const documentContent = (() => {
    if (!rawText) return null;
    if (customization?.renderDocumentText) {
      return customization.renderDocumentText(rawText, record);
    }
    return rawText;
  })();

  const metadataEntries = Object.entries(record).filter(([key]) => !excludeSet.has(key));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-full max-h-[80vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Row Details{titleSuffix}</DialogTitle>
          <DialogDescription className="sr-only">
            Full row text and metadata for the selected result.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto max-h-[calc(80vh-120px)] pr-1">
          {/* Summary / customization fields */}
          {customization?.summaryFields && customization.summaryFields.length > 0 && (
            <div className="mb-6 grid grid-cols-2 gap-4 text-body">
              {customization.summaryFields.map((field) => (
                <div key={field.label}>
                  <span className="font-medium text-foreground">{field.label}:</span>
                  <span
                    className={`ml-2 ${field.highlight ? 'font-mono bg-[var(--vscode-editor-findMatchHighlightBackground)] px-1 rounded-sm' : ''}`}
                  >
                    {field.value}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Document text */}
          {documentContent !== null && (
            <div className="mb-6">
              <h4 className="font-medium text-foreground mb-2">
                Document{textColumn ? `: ${textColumn}` : ''}
              </h4>
              <div className="bg-panel p-4 rounded-lg border">
                <div className="font-mono text-body whitespace-pre-wrap max-h-96 overflow-y-auto">
                  {documentContent}
                </div>
              </div>
            </div>
          )}

          {/* Metadata table */}
          {metadataEntries.length > 0 && (
            <div>
              <h4 className="font-medium text-foreground mb-2">Metadata</h4>
              <div className="bg-surface border border-surface-border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader className="bg-panel">
                    <TableRow>
                      <TableHead className="px-3 py-2 text-left text-label-secondary font-medium uppercase tracking-wider text-description">
                        Field
                      </TableHead>
                      <TableHead className="px-3 py-2 text-left text-label-secondary font-medium uppercase tracking-wider text-description">
                        Value
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {metadataEntries.map(([key, value]) => {
                      const displayValue = formatMetadataValue(value);
                      return (
                        <TableRow key={key}>
                          <TableCell className="font-medium">{key}</TableCell>
                          <TableCell>
                            <div className="max-w-md whitespace-pre-wrap wrap-break-word">
                              {typeof value === 'object' && value !== null ? (
                                <pre className="text-label-secondary bg-panel p-2 rounded-sm overflow-x-auto">
                                  {displayValue}
                                </pre>
                              ) : (
                                displayValue
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
