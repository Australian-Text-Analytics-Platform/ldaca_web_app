import * as React from 'react';

import { cn } from '@/lib/utils';

interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
  containerClassName?: string;
  disableContainer?: boolean;
}

/** Responsive table primitive used by data previews and feature result tables. */
const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, containerClassName, disableContainer = false, ...props }, ref) => {
    const tableElement = (
      <table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...props} />
    );

    if (disableContainer) {
      return tableElement;
    }

    return (
      <div className={cn('relative w-full overflow-auto', containerClassName)}>{tableElement}</div>
    );
  },
);
Table.displayName = 'Table';

/** Table header section used by shared table layouts. */
const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn('[&_tr]:border-b', className)} {...props} />
));
TableHeader.displayName = 'TableHeader';

/** Table body section used for rows rendered by feature and workspace tables. */
const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
));
TableBody.displayName = 'TableBody';

/** Table footer section used where summaries or footer controls need table semantics. */
const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn('border-t bg-muted/50 font-medium [&>tr]:last:border-b-0', className)}
    {...props}
  />
));
TableFooter.displayName = 'TableFooter';

/** Table row primitive with shared hover/selected styling for data grids. */
const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        'border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted',
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = 'TableRow';

/** Table header cell primitive used by app tables for consistent alignment and checkbox spacing. */
const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      'h-10 px-2 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 *:[[role=checkbox]]:translate-y-0.5',
      className,
    )}
    {...props}
  />
));
TableHead.displayName = 'TableHead';

/** Table data cell primitive used by feature rows and workspace data previews. */
const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      'p-2 align-middle [&:has([role=checkbox])]:pr-0 *:[[role=checkbox]]:translate-y-0.5',
      className,
    )}
    {...props}
  />
));
TableCell.displayName = 'TableCell';

/** Table caption primitive used when callers need accessible table context below data. */
const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn('mt-4 text-sm text-muted-foreground', className)} {...props} />
));
TableCaption.displayName = 'TableCaption';

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
