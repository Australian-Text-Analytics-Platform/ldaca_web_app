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

type MetadataColumnSelectorProps = {
  showMetadata: boolean;
  onShowMetadataChange: (showMetadata: boolean) => void;
  availableColumns: string[];
  selectedColumns: string[];
  onSelectedColumnsChange: (columns: string[]) => void;
};

export const MetadataColumnSelector: React.FC<MetadataColumnSelectorProps> = ({
  showMetadata,
  onShowMetadataChange,
  availableColumns,
  selectedColumns,
  onSelectedColumnsChange,
}) => {
  const normalizedAvailableColumns = normalizeMetadataColumns(availableColumns);
  const normalizedSelectedColumns = normalizeMetadataColumns(selectedColumns).filter((column) =>
    normalizedAvailableColumns.includes(column),
  );
  const allSelected =
    normalizedAvailableColumns.length > 0 &&
    normalizedSelectedColumns.length === normalizedAvailableColumns.length;

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
          {normalizedAvailableColumns.map((column) => (
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