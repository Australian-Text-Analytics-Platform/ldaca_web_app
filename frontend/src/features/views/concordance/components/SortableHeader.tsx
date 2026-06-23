import { TableHead } from '@/components/ui/table';
import type { PaginationState } from '../hooks/useConcordanceTaskFlow';

interface Props {
  columnKey: string;
  label: string;
  paginationKey: string;
  requestNodeId: string;
  nodePagination: PaginationState;
  onSort: (columnKey: string, paginationKey: string, requestNodeId: string) => void;
}

/**
 * Rendered by: ConcordanceTableNodeBlock as the concordance table's reusable sortable header affordance because the analysis route needs this component to assemble the selected tab state, controls, task lifecycle, and results surface.
 * Flow: derive display state, bind user actions, then render the analysis UI.
 */
export function SortableHeader({
  columnKey,
  label,
  paginationKey,
  requestNodeId,
  nodePagination,
  onSort,
}: Props) {
  const nodeState = nodePagination[paginationKey] ?? { sortBy: '', descending: false };
  const isSorted = nodeState.sortBy === columnKey;
  const sortIcon = isSorted ? (nodeState.descending ? '▼' : '▲') : '▲▼';

  return (
    <TableHead
      className={`px-3 py-2 text-left text-xs font-medium uppercase tracking-wider cursor-pointer hover:bg-gray-100 ${isSorted ? 'text-blue-600' : 'text-gray-500'}`}
      onClick={() => {
        onSort(columnKey, paginationKey, requestNodeId);
      }}
    >
      <div className="flex items-center space-x-1">
        <span>{label}</span>
        <span className={`text-xs ${isSorted ? 'text-blue-600' : 'text-gray-400'}`}>
          {sortIcon}
        </span>
      </div>
    </TableHead>
  );
}
