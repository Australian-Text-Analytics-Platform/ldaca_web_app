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
import { CHART_IMAGE_FORMATS, type ChartImageFormat } from '@/lib/chartExport';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  onConfirm: (format: ChartImageFormat) => void;
};

const ChartImageDownloadDialogContent = ({
  title = 'Download Chart',
  onConfirm,
  onOpenChange,
}: Omit<Props, 'open'>) => {
  const [selectedFormat, setSelectedFormat] = useState<ChartImageFormat>('png');

  const handleConfirm = (e: React.MouseEvent) => {
    e.preventDefault();
    onConfirm(selectedFormat);
    onOpenChange(false);
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

      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction onClick={handleConfirm}>Download</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
};

export const ChartImageDownloadDialog = ({ open, onOpenChange, title, onConfirm }: Props) => (
  <AlertDialog open={open} onOpenChange={onOpenChange}>
    {open ? (
      <ChartImageDownloadDialogContent
        title={title}
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
      />
    ) : null}
  </AlertDialog>
);
