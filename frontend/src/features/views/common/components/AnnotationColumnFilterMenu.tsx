import { Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  type AnnotationExistenceFilter,
  type AnnotationRowFilterValue,
  INACTIVE_ANNOTATION_FILTER,
  isAnnotationRowFilterActive,
} from '@/features/views/annotation/annotationRowFilter';

const EXISTENCE_OPTIONS: { value: AnnotationExistenceFilter; label: string }[] = [
  { value: 'off', label: 'All rows' },
  { value: 'present', label: 'Has value' },
  { value: 'empty', label: 'Empty' },
];

const isExistenceFilter = (value: string): value is AnnotationExistenceFilter =>
  EXISTENCE_OPTIONS.some((option) => option.value === value);

interface AnnotationColumnFilterMenuProps {
  column: string;
  value: AnnotationRowFilterValue;
  onChange: (value: AnnotationRowFilterValue) => void;
  /** Menu text for the difference condition, e.g. "Differs from annotation". */
  differsLabel: string;
  /** Disables only the difference condition, e.g. when no comparison column is selected. */
  differsDisabled?: boolean;
  differsDisabledReason?: string;
}

/**
 * Header dropdown holding one column's row filter for Annotation Manual and Review tables.
 * Flow: the funnel button reports active state whenever any condition is on; the difference
 * checkbox and the existence radio group are independent conditions the table ANDs together.
 * Choosing Empty greys out the difference condition because an empty cell never differs.
 * Callers keep the menu usable while the column's values are masked.
 */
export function AnnotationColumnFilterMenu({
  column,
  value,
  onChange,
  differsLabel,
  differsDisabled = false,
  differsDisabledReason,
}: AnnotationColumnFilterMenuProps) {
  const active = isAnnotationRowFilterActive(value);
  const differsBlocked = differsDisabled || value.existence === 'empty';

  return (
    <DropdownMenu>
      <TooltipProvider delayDuration={120} skipDelayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant={active ? 'default' : 'outline'}
                size="sm"
                className="size-7 p-0"
                aria-label={`Filter rows by ${column}`}
                aria-pressed={active}
                data-filter-active={active ? 'true' : 'false'}
              >
                <Filter aria-hidden="true" className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{active ? 'Filter active' : 'Filter rows'}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Filter rows by {column}</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={value.differs && !differsBlocked}
          disabled={differsBlocked}
          title={differsDisabled ? differsDisabledReason : undefined}
          onCheckedChange={(checked) => {
            onChange({ ...value, differs: checked });
          }}
          onSelect={(event) => {
            event.preventDefault();
          }}
        >
          {differsLabel}
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={value.existence}
          onValueChange={(next) => {
            if (!isExistenceFilter(next)) return;
            onChange({
              differs: next === 'empty' ? false : value.differs,
              existence: next,
            });
          }}
        >
          {EXISTENCE_OPTIONS.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              onSelect={(event) => {
                event.preventDefault();
              }}
            >
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={!active}
          disabled={!active}
          onCheckedChange={() => {
            onChange(INACTIVE_ANNOTATION_FILTER);
          }}
          onSelect={(event) => {
            event.preventDefault();
          }}
        >
          Clear filter
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
