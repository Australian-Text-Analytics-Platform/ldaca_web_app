import * as React from 'react';

import { cn } from '@/lib/utils';

interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
  containerClassName?: string;
  disableContainer?: boolean;
  ref?: React.Ref<HTMLTableElement>;
}

/** Responsive table primitive used by data previews and feature result tables. */
const Table = ({
  className,
  containerClassName,
  disableContainer = false,
  ref,
  ...props
}: TableProps) => {
  const tableElement = (
    <table ref={ref} className={cn('w-full caption-bottom text-body', className)} {...props} />
  );

  if (disableContainer) return tableElement;

  return (
    <div className={cn('relative w-full overflow-auto', containerClassName)}>{tableElement}</div>
  );
};

/** Table header section used by shared table layouts. */
const TableHeader = ({ className, ref, ...props }: React.ComponentProps<'thead'>) => (
  <thead ref={ref} className={cn('[&_tr]:border-b', className)} {...props} />
);

/** Table body section used for rows rendered by feature and workspace tables. */
const TableBody = ({ className, ref, ...props }: React.ComponentProps<'tbody'>) => (
  <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
);

/** Table row primitive with shared hover/selected styling for data grids. */
const TableRow = ({ className, ref, ...props }: React.ComponentProps<'tr'>) => (
  <tr
    ref={ref}
    className={cn(
      'border-b transition-colors hover:bg-list-hover data-[state=selected]:bg-list-inactive',
      className,
    )}
    {...props}
  />
);

/** Table header cell primitive used by app tables for consistent alignment and checkbox spacing. */
const TableHead = ({ className, ref, ...props }: React.ComponentProps<'th'>) => (
  <th
    ref={ref}
    className={cn(
      'h-pane-header px-2 text-left align-middle text-label font-semibold text-description [&:has([role=checkbox])]:pr-0 *:[[role=checkbox]]:translate-y-0.5',
      className,
    )}
    {...props}
  />
);

/** Table data cell primitive used by feature rows and workspace data previews. */
const TableCell = ({ className, ref, ...props }: React.ComponentProps<'td'>) => (
  <td
    ref={ref}
    className={cn(
      'px-2 py-1 align-middle [&:has([role=checkbox])]:pr-0 *:[[role=checkbox]]:translate-y-0.5',
      className,
    )}
    {...props}
  />
);

export { Table, TableHeader, TableBody, TableHead, TableRow, TableCell };
