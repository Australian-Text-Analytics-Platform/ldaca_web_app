import { useState } from 'react';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { CHART_IMAGE_FORMATS, type ChartImageFormat } from '@/lib/chartExport';

export interface ChartDownloadExtraOption {
  id: string;
  label: string;
  defaultChecked?: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  onConfirm: (format: ChartImageFormat, extras: Record<string, boolean>) => void;
  extraOptions?: ChartDownloadExtraOption[];
}

/**
 * Dialog body used by chart result components to choose image format and export extras.
 * Why: chart result actions share the same AlertDialog export chooser for image formats and optional overlays.
 * Flow: initialize selected format and extra checkboxes, render AlertDialog form sections, then confirm with format/extras and close.
 */
const ChartImageDownloadDialogContent = ({
  title = 'Download Chart',
  onConfirm,
  onOpenChange,
  extraOptions = [],
}: Omit<Props, 'open'>) => {
  const [selectedFormat, setSelectedFormat] = useState<ChartImageFormat>('png');
  const [extraStates, setExtraStates] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(extraOptions.map((opt) => [opt.id, opt.defaultChecked ?? false])),
  );

  /** Called by: ChartImageDownloadDialogContent Download action because the caller needs one documented boundary for the lookup, event, or state handoff step. */
  const handleConfirm = (e: React.MouseEvent) => {
    e.preventDefault();
    onConfirm(selectedFormat, extraStates);
    onOpenChange(false);
  };

  /** Called by: ChartImageDownloadDialogContent extra-option checkboxes because the caller needs one documented boundary for the lookup, event, or state handoff step. */
  const toggleExtra = (id: string, checked: boolean) => {
    setExtraStates((prev) => ({ ...prev, [id]: checked }));
  };

  return (
    <AlertDialogContent className="max-w-sm">
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>Choose image format for the chart export.</AlertDialogDescription>
      </AlertDialogHeader>

      <div className="space-y-2 py-2">
        <Label className="text-sm font-medium">Format</Label>
        <div className="flex flex-wrap gap-3">
          {CHART_IMAGE_FORMATS.map((fmt) => (
            <label key={fmt.value} className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={selectedFormat === fmt.value}
                onCheckedChange={(checked) => {
                  if (checked) setSelectedFormat(fmt.value);
                }}
              />
              <span className="text-sm">{fmt.label}</span>
            </label>
          ))}
        </div>
      </div>

      {extraOptions.length > 0 && (
        <>
          <Separator />
          <div className="space-y-2 py-1">
            {extraOptions.map((opt) => (
              <label key={opt.id} className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  checked={extraStates[opt.id] ?? false}
                  onCheckedChange={(checked) => { toggleExtra(opt.id, checked === true); }}
                />
                <span className="text-sm">{opt.label}</span>
              </label>
            ))}
          </div>
        </>
      )}

      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction onClick={handleConfirm}>Download</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
};

/**
 * Alert-dialog wrapper used by chart result actions before exporting PNG/SVG/JPEG images.
 * Why: shared UI callers need a stable primitive boundary for layout, accessibility, and composition.
 */
export const ChartImageDownloadDialog = ({
  open,
  onOpenChange,
  title,
  onConfirm,
  extraOptions,
}: Props) => (
  <AlertDialog open={open} onOpenChange={onOpenChange}>
    {open ? (
      <ChartImageDownloadDialogContent
        title={title}
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
        extraOptions={extraOptions}
      />
    ) : null}
  </AlertDialog>
);
