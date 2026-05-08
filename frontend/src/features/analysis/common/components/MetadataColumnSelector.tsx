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
};

type MetadataColumnSelectorProps = {
  showMetadata: boolean;
  onShowMetadataChange: (showMetadata: boolean) => void;
  availableColumns: string[];
  selectedColumns: string[];
  onSelectedColumnsChange: (columns: string[]) => void;
  /**
   * Optional grouping of `availableColumns`. When provided and there is more
   * than one section (or any section has a label), the dropdown renders each
   * group with a heading and divider so users can tell which block a column
   * came from. When omitted the dropdown falls back to a flat list.
   */
  sections?: MetadataColumnSection[];
};

export const MetadataColumnSelector: React.FC<MetadataColumnSelectorProps> = ({
  showMetadata,
  onShowMetadataChange,
  availableColumns,
  selectedColumns,
  onSelectedColumnsChange,
  sections,
}) => {
  const normalizedAvailableColumns = normalizeMetadataColumns(availableColumns);
  const normalizedSelectedColumns = normalizeMetadataColumns(selectedColumns).filter((column) =>
    normalizedAvailableColumns.includes(column),
  );
  const allSelected =
    normalizedAvailableColumns.length > 0 &&
    normalizedSelectedColumns.length === normalizedAvailableColumns.length;
  const useSections =
    Array.isArray(sections) &&
    sections.length > 1;

  const toggleColumn = (column: string, checked: boolean) => {
    if (checked) {
      onSelectedColumnsChange(normalizeMetadataColumns([...normalizedSelectedColumns, column]));
      return;
    }

    onSelectedColumnsChange(normalizedSelectedColumns.filter((selectedColumn) => selectedColumn !== column));
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-sm text-foreground">
        <Checkbox
          checked={showMetadata}
          onCheckedChange={(checked) => onShowMetadataChange(checked === true)}
          aria-label="Show metadata"
        />
        <span>Show metadata</span>
      </label>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!showMetadata || normalizedAvailableColumns.length === 0}
            aria-label="Metadata columns"
          >
            Metadata columns ({normalizedSelectedColumns.length})
            <ChevronDown className="ml-2 h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuCheckboxItem
            checked={allSelected}
            onCheckedChange={(checked) => {
              onSelectedColumnsChange(checked === true ? normalizedAvailableColumns : []);
            }}
            onSelect={(event) => event.preventDefault()}
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