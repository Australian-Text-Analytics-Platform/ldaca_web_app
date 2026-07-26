import { Loader2 } from 'lucide-react';

import { TableCell, TableRow } from '@/components/ui/table';

interface PaginatedTableProcessingRowProps {
  columnCount: number;
  label?: string;
}

/**
 * Keeps a paginated table body mounted while its requested server page is
 * processing. The surrounding feature continues to own headers and pagination.
 */
export function PaginatedTableProcessingRow({
  columnCount,
  label = 'Processing preview page',
}: PaginatedTableProcessingRowProps) {
  return (
    <TableRow aria-busy="true">
      <TableCell className="h-24 text-center" colSpan={Math.max(columnCount, 1)}>
        <span
          role="status"
          aria-label={label}
          className="inline-flex items-center justify-center text-muted-foreground"
        >
          <Loader2 aria-hidden="true" className="size-5 animate-spin" />
        </span>
      </TableCell>
    </TableRow>
  );
}
