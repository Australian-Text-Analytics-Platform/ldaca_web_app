/**
 * Read-only "what is the stopword filter actually removing?" view.
 *
 * Topic modelling's stopword filter is a binary toggle today — it
 * silently drops any representative word that appears in the bundled
 * list for the resolved language. Users have asked for visibility into
 * *which* words it's hiding, especially on a Chinese corpus where the
 * built-in goto456 list is large (~746 entries) and contains some
 * domain-sensitive choices (e.g. 的/是/了 are obvious; 上/下 less so).
 *
 * This dialog displays the active set unchanged — no add / remove /
 * sort controls. Customisation is deliberately out of scope until we
 * see how the read-only view performs in real use.
 */
import { useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { languageLabel } from '@/lib/languages';

export interface AppliedStopwordsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Resolved language code from ``meta.language_resolution.language``
   *  (multilingual branch) or the implicit ``"en"`` fallback. Drives
   *  the dialog title's language label. */
  language: string;
  /** The active set fed to the topics-filtering memo. Rendered in the
   *  order it was inserted so the user sees the same shape the backend
   *  returned (typically alphabetical for EN, frequency-ordered for ZH). */
  stopwords: Set<string>;
}

export function AppliedStopwordsDialog({
  open,
  onClose,
  language,
  stopwords,
}: AppliedStopwordsDialogProps) {
  const words = useMemo(() => Array.from(stopwords), [stopwords]);
  const label = languageLabel(language);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Stopwords being filtered</DialogTitle>
          <DialogDescription>
            {words.length} {label} stopword{words.length === 1 ? '' : 's'}{' '}
            are hidden from each topic&apos;s representative words while
            the filter is on. The source list comes from the backend
            bundle for this language.
          </DialogDescription>
        </DialogHeader>

        {words.length === 0 ? (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-4 text-sm text-muted-foreground">
            No stopwords available for {label}.
          </div>
        ) : (
          <ScrollArea className="h-64 rounded-md border border-border bg-background">
            <div className="flex flex-wrap gap-1.5 p-3 font-mono text-xs">
              {words.map((word) => (
                <span
                  key={word}
                  className="inline-flex items-center rounded bg-muted px-1.5 py-0.5"
                >
                  {word}
                </span>
              ))}
            </div>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AppliedStopwordsDialog;
