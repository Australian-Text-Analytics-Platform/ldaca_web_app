import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDetectedColumnLanguage } from '@/features/views/common/hooks/useDetectedColumnLanguage';
import { listSupportedStopwordLanguages } from '@/lib/loadMergedStopwords';

export interface FillDefaultStopWordsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Workspace + node + column used to guess the language from sampled text. */
  workspaceId: string | null;
  nodeId: string | null;
  column: string | null;
  getAuthHeaders: () => Record<string, string>;
  /** True while the chosen stoplist is being loaded into the editor. */
  isLoading: boolean;
  /** Loads default stop words for the picked ISO 639-1 language. */
  onFill: (language: string) => void;
}

/**
 * Prompts the user to confirm which language's default stop words to add.
 * Used by: TokenFrequencyFeature when the "Add Default" button is clicked,
 * because language is not an intrinsic column property (a column may mix
 * languages) and must be chosen per scenario rather than stored.
 * Flow: when open, guess the language from the selected column's sampled text
 * and pre-select it; let the user override via the dropdown; on Add, hand the
 * chosen ISO 639-1 code back to the feature (which appends that language's bag
 * to the existing stop-word list) and close.
 */
function FillDefaultStopWordsDialog({
  open,
  onOpenChange,
  workspaceId,
  nodeId,
  column,
  getAuthHeaders,
  isLoading,
  onFill,
}: FillDefaultStopWordsDialogProps) {
  const languages = listSupportedStopwordLanguages();
  const { detectedLanguage, isDetecting } = useDetectedColumnLanguage({
    workspaceId,
    nodeId,
    column,
    getAuthHeaders,
    enabled: open,
  });

  // `picked` holds the user's explicit override for this open session. The
  // parent remounts this component when the dialog opens (via `key`), so the
  // override resets to null automatically without a reset effect.
  const [picked, setPicked] = useState<string | null>(null);

  // The dropdown shows the user's explicit pick when present, otherwise the
  // detected guess (only if it maps to a supported stoplist). Deriving the
  // value avoids syncing detection into state inside an effect.
  const guessed =
    detectedLanguage && languages.some((language) => language.iso6391 === detectedLanguage)
      ? detectedLanguage
      : '';
  const selected = picked ?? guessed;

  const handleFill = () => {
    if (!selected) return;
    onFill(selected);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add default stop words</DialogTitle>
          <DialogDescription>
            Choose the language whose default stop words you want to add. They are appended to your
            current list, so you can stack bags from several languages. The guess below is based on
            the selected column's text and can be changed.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Select value={selected} onValueChange={setPicked} disabled={isLoading}>
            <SelectTrigger className="w-full" aria-label="Stop words language">
              <SelectValue placeholder={isDetecting ? 'Detecting language…' : 'Select a language'} />
            </SelectTrigger>
            <SelectContent>
              {languages.map((language) => (
                <SelectItem key={language.iso6391} value={language.iso6391}>
                  {language.iso6391 === guessed ? `${language.name} (Recommended)` : language.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleFill} disabled={isLoading || !selected}>
            {isLoading ? 'Adding…' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default FillDefaultStopWordsDialog;
