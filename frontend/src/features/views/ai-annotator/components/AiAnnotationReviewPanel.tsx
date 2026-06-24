import type { Table as TanStackTable } from '@tanstack/react-table';
import { Plus } from 'lucide-react';

import type { AiAnnotationNodeResult } from '@/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ServerPaginationFooter } from '../../common/components/ServerPaginationFooter';
import {
  buildAiAnnotationEditKey,
  deriveAiAnnotationReviewCategories,
  deriveAiAnnotationReviewProviders,
  getAiAnnotationReviewValue,
  stringifyAiAnnotationCell,
} from '../hooks/aiAnnotationReviewModel';

const AI_REVIEW_PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 100];

interface AiAnnotationReviewPanelProps {
  reviewData: AiAnnotationNodeResult;
  reviewNodeId: string;
  reviewTextColumn: string;
  reviewAnnotationColumn: string;
  reviewGlobalProviders: string[];
  additionalProviders: string[];
  reviewGlobalCategories: string[];
  temporaryCategories: string[];
  reviewEdits: Record<string, string>;
  savingReviewCells: Record<string, boolean>;
  table: TanStackTable<Record<string, unknown>>;
  pageIndex: number;
  pageSize: number;
  rowCount: number;
  loading: boolean;
  isAddAnnotatorDialogOpen: boolean;
  onAddAnnotatorDialogOpenChange: (open: boolean) => void;
  newProviderName: string;
  onNewProviderNameChange: (value: string) => void;
  onAddProvider: () => void;
  isAddCategoryDialogOpen: boolean;
  onAddCategoryDialogOpenChange: (open: boolean) => void;
  newCategoryName: string;
  onNewCategoryNameChange: (value: string) => void;
  onConfirmAddCategory: () => void | Promise<void>;
  onCategorySelected: (
    row: Record<string, unknown>,
    rowIndex: number,
    providerName: string,
    annotationColumn: string,
    selectedValue: string,
  ) => void | Promise<void>;
}

/**
 * Renders the editable AI annotation review grid and its add dialogs.
 * Rendered by: AiAnnotatorFeature after useAiAnnotationReviewWorkflow has
 * loaded review rows and exposed save/dialog callbacks.
 * Flow: derive visible provider/category options, render the two-level review
 * table header, route category selections to the workflow hook, and delegate
 * pagination through ServerPaginationFooter.
 */
export function AiAnnotationReviewPanel({
  reviewData,
  reviewNodeId,
  reviewTextColumn,
  reviewAnnotationColumn,
  reviewGlobalProviders,
  additionalProviders,
  reviewGlobalCategories,
  temporaryCategories,
  reviewEdits,
  savingReviewCells,
  table,
  pageIndex,
  pageSize,
  rowCount,
  loading,
  isAddAnnotatorDialogOpen,
  onAddAnnotatorDialogOpenChange,
  newProviderName,
  onNewProviderNameChange,
  onAddProvider,
  isAddCategoryDialogOpen,
  onAddCategoryDialogOpenChange,
  newCategoryName,
  onNewCategoryNameChange,
  onConfirmAddCategory,
  onCategorySelected,
}: AiAnnotationReviewPanelProps) {
  const rows = reviewData.data;
  const pagination = reviewData.pagination;
  const page = pagination?.page ?? 1;
  const currentPageSize = pagination?.page_size ?? pageSize;
  const providers = deriveAiAnnotationReviewProviders(
    rows,
    reviewAnnotationColumn,
    reviewGlobalProviders,
    additionalProviders,
  );
  const categoryOptions = deriveAiAnnotationReviewCategories(
    rows,
    reviewAnnotationColumn,
    reviewGlobalCategories,
    temporaryCategories,
  );

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Review Annotations</CardTitle>
            <CardDescription>
              Node: <span className="font-mono text-xs">{reviewNodeId}</span>
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-border bg-card">
          <ScrollArea scrollbars="both" className="max-h-[70vh]">
            <div className="min-w-max">
              <Table className="min-w-180" disableContainer>
                <TableHeader className="sticky top-0 z-10">
                  <TableRow className="bg-muted/90 backdrop-blur-sm border-b border-border/80">
                    <TableHead className="whitespace-nowrap border-r border-border/70 bg-muted/90 py-2">
                      <div className="flex items-center justify-center gap-2">
                        <span className="font-semibold tracking-tight">text</span>
                        <span className="rounded-full border border-border/70 bg-background/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          1 column
                        </span>
                      </div>
                    </TableHead>
                    <TableHead
                      colSpan={providers.length + 1}
                      className="border-b-2 border-border/80 bg-muted/90 py-2"
                    >
                      <div className="flex items-center justify-center gap-2">
                        <span className="font-semibold tracking-tight">
                          {reviewAnnotationColumn}
                        </span>
                      </div>
                    </TableHead>
                  </TableRow>
                  <TableRow className="bg-muted/80 backdrop-blur-sm border-b border-border/80">
                    <TableHead className="whitespace-nowrap border-r border-border/70 bg-muted/80">
                      {reviewTextColumn}
                    </TableHead>
                    {providers.map((providerName) => (
                      <TableHead
                        key={providerName}
                        className="whitespace-nowrap border-r border-border/60"
                      >
                        {providerName}
                      </TableHead>
                    ))}
                    <TableHead className="w-12 min-w-12 text-center border-l border-border/70">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded-full border border-border/60 hover:border-border"
                        onClick={() => {
                          onAddAnnotatorDialogOpenChange(true);
                        }}
                        aria-label="Add annotator"
                        title="Add annotator"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length > 0 ? (
                    rows.map((row, rowIdx) => {
                      const rowIndex = (Math.max(page, 1) - 1) * currentPageSize + rowIdx;
                      return (
                        <TableRow key={String(rowIndex)}>
                          <TableCell className="align-top max-w-xl whitespace-pre-wrap wrap-break-word">
                            {stringifyAiAnnotationCell(row[reviewTextColumn])}
                          </TableCell>
                          {providers.map((providerName) => (
                            <TableCell
                              key={`${String(rowIndex)}-${providerName}`}
                              className="align-top min-w-40"
                            >
                              <Select
                                value={
                                  getAiAnnotationReviewValue({
                                    row,
                                    providerName,
                                    rowIndex,
                                    annotationColumn: reviewAnnotationColumn,
                                    reviewEdits,
                                  }) || '__empty__'
                                }
                                onValueChange={(value) => {
                                  void onCategorySelected(
                                    row,
                                    rowIndex,
                                    providerName,
                                    reviewAnnotationColumn,
                                    value,
                                  );
                                }}
                                disabled={Boolean(
                                  savingReviewCells[
                                    buildAiAnnotationEditKey(rowIndex, providerName)
                                  ],
                                )}
                              >
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder="Select category" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__add_new_category__">
                                    + Add a new category
                                  </SelectItem>
                                  <SelectItem value="__empty__">(empty)</SelectItem>
                                  {categoryOptions.map((category) => (
                                    <SelectItem key={category} value={category}>
                                      {category}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                          ))}
                          <TableCell className="w-12" />
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={Math.max(providers.length + 2, 1)}
                        className="h-24 text-center text-muted-foreground"
                      >
                        No annotation rows available for review.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </ScrollArea>
        </div>

        <ServerPaginationFooter
          table={table}
          pageIndex={pageIndex}
          pageSize={pageSize}
          rowCount={rowCount}
          pageSizeOptions={AI_REVIEW_PAGE_SIZE_OPTIONS}
          loading={loading}
        />

        <AlertDialog open={isAddAnnotatorDialogOpen} onOpenChange={onAddAnnotatorDialogOpenChange}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Add Annotator</AlertDialogTitle>
              <AlertDialogDescription>
                Enter the annotator name to add a new review column.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Input
              value={newProviderName}
              onChange={(event) => {
                onNewProviderNameChange(event.target.value);
              }}
              placeholder="e.g. userA"
              autoFocus
            />
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onAddProvider}>Add</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={isAddCategoryDialogOpen} onOpenChange={onAddCategoryDialogOpenChange}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Add a New Category</AlertDialogTitle>
              <AlertDialogDescription>
                This category is temporary in the frontend and will reset on page change.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Input
              value={newCategoryName}
              onChange={(event) => {
                onNewCategoryNameChange(event.target.value);
              }}
              placeholder="e.g. mixed"
              autoFocus
            />
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => void onConfirmAddCategory()}>
                Add Category
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
