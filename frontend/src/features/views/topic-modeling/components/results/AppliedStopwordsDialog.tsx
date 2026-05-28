/**
 * Read-only "what is the stopword filter actually removing?" view.
 *
 * Topic modelling's stopword filter is a binary toggle today — it
 * silently drops any representative word that appears in the bundled
 * list for the resolved language(s). Users have asked for visibility
 * into *which* words it's hiding, especially on a Chinese corpus where
 * the built-in goto456 list is large (~746 entries) and contains some
 * domain-sensitive choices (e.g. 的/是/了 are obvious; 上/下 less so).
 *
 * When the run spans multiple languages (e.g. an EN + ZH side-by-side
 * comparison) the dialog renders one chip block per language with a
 * heading, mirroring the per-language grouping token-frequency shows
 * in its textarea.
 *
 * This dialog is deliberately read-only — no add / remove / sort
 * controls. Customisation is out of scope until we see how the
 * read-only view performs in real use.
 */
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
  /** Total surviving across all groups after backend dedupe. Drives
   *  the dialog's "X stopwords are hidden" count. */
  totalCount: number;
  /** Per-language groups in the order the run resolved them. Single-
   *  language runs pass a one-element array and the dialog collapses
   *  the heading. */
  byLanguage: ReadonlyArray<{
    language: string;
    words: ReadonlyArray<string>;
  }>;
}

/**
 * Rendered by: TopicModelingResultsPanel to display stopword groups hidden from representative topic words because the analysis route needs this component to assemble the selected tab state, controls, task lifecycle, and results surface.
 * Flow: derive display state, bind user actions, then render the analysis UI.
 */
export function AppliedStopwordsDialog({
  open,
  onClose,
  totalCount,
  byLanguage,
}: AppliedStopwordsDialogProps) {
  const nonEmptyGroups = byLanguage.filter((group) => group.words.length > 0);
  const isMultiLanguage = nonEmptyGroups.length > 1;
  const languageSummary = nonEmptyGroups.map((group) => languageLabel(group.language)).join(' + ');

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
            {totalCount} {languageSummary || 'English'} stopword
            {totalCount === 1 ? '' : 's'} {totalCount === 1 ? 'is' : 'are'} hidden from each
            topic&apos;s representative words while the filter is on. The source list comes from the
            backend bundle
            {isMultiLanguage ? ' (one per corpus language)' : ''}.
          </DialogDescription>
        </DialogHeader>

        {nonEmptyGroups.length === 0 ? (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-4 text-sm text-muted-foreground">
            No stopwords available for the resolved language.
          </div>
        ) : (
          <ScrollArea className="h-64 rounded-md border border-border bg-background">
            <div className="space-y-3 p-3">
              {nonEmptyGroups.map((group) => (
                <div key={group.language} className="space-y-1.5">
                  {isMultiLanguage ? (
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {languageLabel(group.language)} ({group.words.length})
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-1.5 font-mono text-xs">
                    {group.words.map((word) => (
                      <span
                        key={`${group.language}:${word}`}
                        className="inline-flex items-center rounded bg-muted px-1.5 py-0.5"
                      >
                        {word}
                      </span>
                    ))}
                  </div>
                </div>
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
