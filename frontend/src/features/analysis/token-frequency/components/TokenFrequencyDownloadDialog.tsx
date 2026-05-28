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
import { useState } from 'react';

export type DownloadDialogMode = 'wordcloud' | 'frequencies';

type WordCloudFormatOption = 'png' | 'jpeg' | 'svg';
type FrequencyFormatOption = 'csv' | 'markdown';

const WORD_CLOUD_FORMATS: { value: WordCloudFormatOption; label: string }[] = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'svg', label: 'SVG' },
];

const FREQUENCY_FORMATS: { value: FrequencyFormatOption; label: string }[] = [
  { value: 'csv', label: 'CSV' },
  { value: 'markdown', label: 'Markdown' },
];

type TokenFrequencyDownloadDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: DownloadDialogMode;
  onConfirm: (options: { format: string; includeStopWords: boolean }) => void;
};

/** Used by: TokenFrequencyDownloadDialogContent to select the initial export format for the current mode because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
const getDefaultFormat = (mode: DownloadDialogMode) => (mode === 'wordcloud' ? 'png' : 'csv');

type TokenFrequencyDownloadDialogContentProps = {
  mode: DownloadDialogMode;
  onConfirm: (options: { format: string; includeStopWords: boolean }) => void;
  onOpenChange: (open: boolean) => void;
};

/**
 * Rendered by: TokenFrequencyDownloadDialog as the modal body for format and stop-word options because the analysis route needs this component to assemble the selected tab state, controls, task lifecycle, and results surface.
 * Flow: derive display state, bind user actions, then render the analysis UI.
 */
const TokenFrequencyDownloadDialogContent = ({
  mode,
  onConfirm,
  onOpenChange,
}: TokenFrequencyDownloadDialogContentProps) => {
  const [selectedFormat, setSelectedFormat] = useState<string>(getDefaultFormat(mode));
  const [includeStopWords, setIncludeStopWords] = useState(true);

  const formats = mode === 'wordcloud' ? WORD_CLOUD_FORMATS : FREQUENCY_FORMATS;
  const title = mode === 'wordcloud' ? 'Download Word Cloud' : 'Download Frequencies';
  const description =
    mode === 'wordcloud'
      ? 'Choose image format for the word cloud export.'
      : 'Choose file format for the frequency data export.';

  /** Called by: TokenFrequencyDownloadDialogContent action button to confirm export options and close because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
  const handleConfirm = (e: React.MouseEvent) => {
    e.preventDefault();
    onConfirm({ format: selectedFormat, includeStopWords });
    onOpenChange(false);
  };

  return (
    <AlertDialogContent className="max-w-sm">
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
      </AlertDialogHeader>

      <div className="space-y-4 py-2">
        <div className="space-y-2">
          <Label className="text-sm font-medium">Format</Label>
          <div className="flex flex-wrap gap-3">
            {formats.map((fmt) => (
              <label key={fmt.value} className="flex items-center gap-2 cursor-pointer">
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

        <div className="flex items-center gap-2 pt-1">
          <Checkbox
            id="include-stop-words"
            checked={includeStopWords}
            onCheckedChange={(checked) => setIncludeStopWords(checked === true)}
          />
          <Label htmlFor="include-stop-words" className="text-sm cursor-pointer">
            Download stop words as well
          </Label>
        </div>
      </div>

      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction onClick={handleConfirm}>Download</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
};

/** Rendered by: TokenFrequencyFeature to host the token-frequency download dialog because the analysis route needs this component to assemble the selected tab state, controls, task lifecycle, and results surface. */
export const TokenFrequencyDownloadDialog = ({
  open,
  onOpenChange,
  mode,
  onConfirm,
}: TokenFrequencyDownloadDialogProps) => {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <TokenFrequencyDownloadDialogContent
          key={mode}
          mode={mode}
          onConfirm={onConfirm}
          onOpenChange={onOpenChange}
        />
      ) : null}
    </AlertDialog>
  );
};
