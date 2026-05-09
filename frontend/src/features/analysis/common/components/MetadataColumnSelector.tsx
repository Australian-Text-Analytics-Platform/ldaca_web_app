import React from 'react';
import { ChevronDown } from 'lucide-react';

import { Button } from '../../../../components/ui/button';
import { Checkbox } from '../../../../components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../../components/ui/dropdown-menu';
import { DisabledReasonTooltip } from '../../../../components/ui/disabled-reason-tooltip';
import { normalizeMetadataColumns } from './metadataColumnSelection';

export type MetadataColumnSection = {
  columns: string[];
  /**
   * Optional foreground colour applied to the items in this section. When
   * provided, the dropdown skips section headers and relies on colour alone
   * to differentiate which data block each column came from — the same
   * colour is used for that block in the NodeSelectionPanel above.
   */
  color?: string;
  /**
   * When true, items in this section render disabled — visible (with their
   * colour tint) but not toggleable. Used by Combined view to indicate
   * that columns exclusive to one source can't be displayed in the
   * combined table.
   */
  disabled?: boolean;
};

type MetadataColumnSelectorProps = {
  showMetadata: boolean;
  onShowMetadataChange: (showMetadata: boolean) => void;
  availableColumns: string[];
  selectedColumns: string[];
  onSelectedColumnsChange: (columns: string[]) => void;
  /**
   * Optional grouping of `availableColumns`. When provided and there is more
   * than one section, the dropdown renders each group with a divider so
   * users can tell which block a column came from. When omitted the dropdown
   * falls back to a flat list.
   */
  sections?: MetadataColumnSection[];
  /**
   * When provided, disables the Show metadata checkbox itself and surfaces
   * the reason via a tooltip. Used to express "the selected data blocks
   * have no shared metadata, so showing metadata isn't meaningful here".
   */
  disabledReason?: string;
};

export const MetadataColumnSelector: React.FC<MetadataColumnSelectorProps> = ({
  showMetadata,
  onShowMetadataChange,
  availableColumns,
  selectedColumns,
  onSelectedColumnsChange,
  sections,
  disabledReason,
}) => {
  const normalizedAvailableColumns = normalizeMetadataColumns(availableColumns);
  const normalizedSelectedColumns = normalizeMetadataColumns(selectedColumns).filter((column) =>
    normalizedAvailableColumns.includes(column),
  );
  const useSections =
    Array.isArray(sections) &&
    sections.length > 1;

  // Columns that the user is allowed to toggle from this dropdown. Items in
  // sections marked `disabled` are excluded — they're shown but inert.
  const selectableColumns = useSections
    ? Array.from(
        new Set(
          sections!
            .filter((s) => !s.disabled)
            .flatMap((s) => normalizeMetadataColumns(s.columns))
            .filter((c) => normalizedAvailableColumns.includes(c)),
        ),
      )
    : normalizedAvailableColumns;

  const allSelectableSelected =
    selectableColumns.length > 0 &&
    selectableColumns.every((c) => normalizedSelectedColumns.includes(c));

  const toggleColumn = (column: string, checked: boolean) => {
    if (checked) {
      onSelectedColumnsChange(normalizeMetadataColumns([...normalizedSelectedColumns, column]));
      return;
    }

    onSelectedColumnsChange(normalizedSelectedColumns.filter((selectedColumn) => selectedColumn !== column));
  };

  const isShowDisabled = !!disabledReason;
  const dropdownTriggerDisabled =
    isShowDisabled || !showMetadata || selectableColumns.length === 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DisabledReasonTooltip reason={isShowDisabled ? disabledReason : undefined}>
        <label
          className={`flex items-center gap-2 text-sm text-foreground ${isShowDisabled ? 'cursor-not-allowed opacity-60' : ''}`}
        >
          <Checkbox
            checked={showMetadata}
            onCheckedChange={(checked) => onShowMetadataChange(checked === true)}
            aria-label="Show metadata"
            disabled={isShowDisabled}
          />
          <span>Show metadata</span>
        </label>
      </DisabledReasonTooltip>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={dropdownTriggerDisabled}
            aria-label="Metadata columns"
            title={dropdownTriggerDisabled ? disabledReason : undefined}
          >
            Metadata columns ({normalizedSelectedColumns.length})
            <ChevronDown className="ml-2 h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuCheckboxItem
            checked={allSelectableSelected}
            // "Select all" only operates on selectable columns; selections
            // already in disabled sections are preserved untouched.
            onCheckedChange={(checked) => {
              if (checked === true) {
                onSelectedColumnsChange(
                  normalizeMetadataColumns([...normalizedSelectedColumns, ...selectableColumns]),
                );
              } else {
                onSelectedColumnsChange(
                  normalizedSelectedColumns.filter((c) => !selectableColumns.includes(c)),
                );
              }
            }}
            onSelect={(event) => event.preventDefault()}
            disabled={selectableColumns.length === 0}
          >
            Select all
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          {useSections
            ? sections!.flatMap((section, sectionIdx) => {
                const items = normalizeMetadataColumns(section.columns).filter((column) =>
                  normalizedAvailableColumns.includes(column),
                );
                if (items.length === 0) return [];
                const out: React.ReactNode[] = [];
                if (sectionIdx > 0) {
                  out.push(<DropdownMenuSeparator key={`sep-${sectionIdx}`} />);
                }
                items.forEach((column) => {
                  out.push(
                    <DropdownMenuCheckboxItem
                      key={`${sectionIdx}-${column}`}
                      checked={normalizedSelectedColumns.includes(column)}
                      onCheckedChange={(checked) => toggleColumn(column, checked === true)}
                      onSelect={(event) => event.preventDefault()}
                      disabled={section.disabled}
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
                  onCheckedChange={(checked) => toggleColumn(column, checked === true)}
                  onSelect={(event) => event.preventDefault()}
                >
                  {column}
                </DropdownMenuCheckboxItem>
              ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
