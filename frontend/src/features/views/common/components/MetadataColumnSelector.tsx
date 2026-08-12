import React from 'react';
import { ChevronDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import { normalizeMetadataColumns } from './metadataColumnSelection';

interface MetadataColumnSection {
  columns: string[];
  /**
   * Optional foreground colour applied to the items in this section. When
   * provided, the dropdown skips section headers and relies on colour alone
   * to differentiate which data block each column came from — the same
   * colour is used for that block in the input panel above.
   */
  color?: string;
  /**
   * When true, items in this section render disabled — visible (with their
   * colour tint) but not toggleable. Used by Combined view to indicate
   * that columns exclusive to one source can't be displayed in the
   * combined table.
   */
  disabled?: boolean;
}

interface MetadataColumnSelectorProps {
  availableColumns: string[];
  selectedColumns: string[];
  onSelectedColumnsChange: (columns: string[]) => void;
  /** Columns owned by another control remain visible but cannot be selected here. */
  disabledColumns?: string[];
  /**
   * Optional grouping of `availableColumns`. When provided and there is more
   * than one section, the dropdown renders each group with a divider so
   * users can tell which block a column came from. When omitted the dropdown
   * falls back to a flat list.
   */
  sections?: MetadataColumnSection[];
  /**
   * When provided, disables the dropdown trigger and surfaces the reason via
   * a tooltip. Used to express "the selected data blocks have no shared
   * metadata, so showing metadata isn't meaningful here" — currently only
   * triggered by Combined view in Concordance when two blocks have no
   * intersecting metadata columns.
   */
  disabledReason?: string;
}

/**
 * Renders the shared metadata-column dropdown used by analysis result tables to
 * choose which row metadata survives in visible and combined views.
 * Used by: Annotation Manual, Preview, and Review tables plus
 * Concordance/Quotation result tables.
 */
export function MetadataColumnSelector({
  availableColumns,
  selectedColumns,
  onSelectedColumnsChange,
  disabledColumns = [],
  sections,
  disabledReason,
}: MetadataColumnSelectorProps) {
  const normalizedAvailableColumns = normalizeMetadataColumns(availableColumns);
  const normalizedSelectedColumns = normalizeMetadataColumns(selectedColumns).filter((column) =>
    normalizedAvailableColumns.includes(column),
  );
  const useSections = Array.isArray(sections) && sections.length > 1;
  const disabledColumnSet = new Set(disabledColumns);

  // Columns that the user is allowed to toggle from this dropdown. Items in
  // sections marked `disabled` are excluded — they're shown but inert.
  const selectableColumns = useSections
    ? Array.from(
        new Set(
          sections
            .filter((s) => !s.disabled)
            .flatMap((s) => normalizeMetadataColumns(s.columns))
            .filter((c) => normalizedAvailableColumns.includes(c) && !disabledColumnSet.has(c)),
        ),
      )
    : normalizedAvailableColumns.filter((column) => !disabledColumnSet.has(column));

  const allSelectableSelected =
    selectableColumns.length > 0 &&
    selectableColumns.every((c) => normalizedSelectedColumns.includes(c));

  /** Called by: MetadataColumnSelector checkbox items. */
  const toggleColumn = (column: string, checked: boolean) => {
    if (checked) {
      onSelectedColumnsChange(normalizeMetadataColumns([...normalizedSelectedColumns, column]));
      return;
    }

    onSelectedColumnsChange(
      normalizedSelectedColumns.filter((selectedColumn) => selectedColumn !== column),
    );
  };

  const triggerDisabled = Boolean(disabledReason);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DropdownMenu>
        <DisabledReasonTooltip reason={triggerDisabled ? disabledReason : undefined}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={triggerDisabled}
              aria-label="Show metadata"
            >
              Show metadata ({normalizedSelectedColumns.length})
              <ChevronDown className="ml-2 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
        </DisabledReasonTooltip>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuCheckboxItem
            checked={allSelectableSelected}
            // "Select all" only operates on selectable columns; selections
            // already in disabled sections are preserved untouched.
            onCheckedChange={(checked) => {
              if (checked) {
                onSelectedColumnsChange(
                  normalizeMetadataColumns([...normalizedSelectedColumns, ...selectableColumns]),
                );
              } else {
                onSelectedColumnsChange(
                  normalizedSelectedColumns.filter((c) => !selectableColumns.includes(c)),
                );
              }
            }}
            onSelect={(event) => {
              event.preventDefault();
            }}
            disabled={selectableColumns.length === 0}
          >
            Select all
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          {useSections
            ? sections.flatMap((section, sectionIdx) => {
                const items = normalizeMetadataColumns(section.columns).filter((column) =>
                  normalizedAvailableColumns.includes(column),
                );
                if (items.length === 0) return [];
                const out: React.ReactNode[] = [];
                if (sectionIdx > 0) {
                  out.push(<DropdownMenuSeparator key={`sep-${String(sectionIdx)}`} />);
                }
                items.forEach((column) => {
                  out.push(
                    <DropdownMenuCheckboxItem
                      key={`${String(sectionIdx)}-${column}`}
                      checked={normalizedSelectedColumns.includes(column)}
                      onCheckedChange={(checked) => {
                        toggleColumn(column, checked);
                      }}
                      onSelect={(event) => {
                        event.preventDefault();
                      }}
                      disabled={(section.disabled ?? false) || disabledColumnSet.has(column)}
                      style={section.color ? { color: section.color } : undefined}
                    >
                      {column}
                    </DropdownMenuCheckboxItem>,
                  );
                });
                return out;
              })
            : normalizedAvailableColumns.map((column) => (
                <DropdownMenuCheckboxItem
                  key={column}
                  checked={normalizedSelectedColumns.includes(column)}
                  disabled={disabledColumnSet.has(column)}
                  onCheckedChange={(checked) => {
                    toggleColumn(column, checked);
                  }}
                  onSelect={(event) => {
                    event.preventDefault();
                  }}
                >
                  {column}
                </DropdownMenuCheckboxItem>
              ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
