/**
 * Phase 4.3: Tokenise action dialog.
 *
 * Picks a source column + language + tokenizer model and POSTs to the
 * Phase 2.5 endpoint (``/workspaces/nodes/{id}/derived/tokens``). The
 * operation is idempotent on ``(source_column, model)`` so re-running it
 * with the same args is safe — backend reports ``is_new`` + an optional
 * ``replaced_column`` so we can decide which toast to surface.
 */
import { useEffect, useMemo, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { nodesApi } from '@/api/nodes';
import { findLanguage, SUPPORTED_LANGUAGES } from '@/lib/languages';
import { usePreferencesStore } from '@/stores/preferencesStore';

export interface TokeniseDialogProps {
  open: boolean;
  onClose: () => void;
  nodeId: string;
  nodeName: string;
  /** All columns available on the active node. */
  columns: string[];
  /**
   * Pre-selected source column (e.g. when invoked from a column header
   * context menu). Optional — falls back to a heuristic when omitted.
   */
  initialColumn?: string | null;
  /** Invoked after a successful tokenise so the caller can refresh node info. */
  onSuccess?: (result: {
    column: string;
    isNew: boolean;
    replacedColumn?: string | null;
  }) => void;
}

/**
 * Pick a sensible default source column: the user-set ``document``
 * column convention if present, otherwise the first column.
 */
function pickDefaultColumn(columns: string[]): string | null {
  if (columns.includes('document')) return 'document';
  if (columns.includes('text')) return 'text';
  return columns[0] ?? null;
}

export function TokeniseDialog({
  open,
  onClose,
  nodeId,
  nodeName,
  columns,
  initialColumn,
  onSuccess,
}: TokeniseDialogProps) {
  const { getAuthHeaders } = useAuth();
  const defaultLanguage = usePreferencesStore((state) => state.defaultLanguage);
  const defaultTokenizerModel = usePreferencesStore(
    (state) => state.defaultTokenizerModel,
  );

  const [sourceColumn, setSourceColumn] = useState<string>(
    initialColumn ?? pickDefaultColumn(columns) ?? '',
  );
  const [language, setLanguage] = useState<string>(defaultLanguage ?? 'en');
  // When the user hasn't manually set a model, derive it from the language
  // choice so a CJK user gets jieba without having to type it.
  const [model, setModel] = useState<string>(
    () => defaultTokenizerModel
      ?? findLanguage(defaultLanguage ?? 'en')?.recommendedModel
      ?? 'bert-base-uncased',
  );
  const [modelUserSet, setModelUserSet] = useState<boolean>(
    Boolean(defaultTokenizerModel),
  );
  const [submitting, setSubmitting] = useState(false);

  // Re-sync defaults when the dialog opens (the user may have changed
  // their language preference between invocations).
  useEffect(() => {
    if (!open) return;
    setSourceColumn(initialColumn ?? pickDefaultColumn(columns) ?? '');
    setLanguage(defaultLanguage ?? 'en');
    setModel(
      defaultTokenizerModel
        ?? findLanguage(defaultLanguage ?? 'en')?.recommendedModel
        ?? 'bert-base-uncased',
    );
    setModelUserSet(Boolean(defaultTokenizerModel));
    setSubmitting(false);
  }, [open, initialColumn, columns, defaultLanguage, defaultTokenizerModel]);

  const recommendedModelForLanguage = useMemo(
    () => findLanguage(language)?.recommendedModel ?? 'bert-base-uncased',
    [language],
  );

  const handleLanguageChange = (next: string) => {
    setLanguage(next);
    if (!modelUserSet) {
      const recommended = findLanguage(next)?.recommendedModel;
      if (recommended) setModel(recommended);
    }
  };

  const canSubmit =
    Boolean(sourceColumn) && Boolean(model.trim()) && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const result = await nodesApi.tokeniseColumn(
        nodeId,
        {
          source_column: sourceColumn,
          model: model.trim(),
          language: language || null,
        },
        getAuthHeaders(),
      );
      if (result.is_new) {
        toast.success(`Tokenised "${sourceColumn}" using ${model.trim()}`);
      } else {
        toast.success(
          `Re-tokenised "${sourceColumn}" (replaced previous ${result.replaced_column ?? 'column'})`,
        );
      }
      onSuccess?.({
        column: result.column,
        isNew: result.is_new,
        replacedColumn: result.replaced_column ?? null,
      });
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Tokenise failed: ${message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-indigo-600" aria-hidden />
            Tokenise “{nodeName}”
          </DialogTitle>
          <DialogDescription>
            Adds a hidden derived tokens column on this node so concordance
            (tokens-mode) and token-frequency can agree on a single
            segmentation. Idempotent — re-running with the same model
            replaces the previous column.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label htmlFor="tokenise-source-column">Source column</Label>
            <Select value={sourceColumn} onValueChange={setSourceColumn}>
              <SelectTrigger id="tokenise-source-column">
                <SelectValue placeholder="Pick a column" />
              </SelectTrigger>
              <SelectContent>
                {columns.map((column) => (
                  <SelectItem key={column} value={column}>
                    {column}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="tokenise-language">Language</Label>
            <Select value={language} onValueChange={handleLanguageChange}>
              <SelectTrigger id="tokenise-language">
                <SelectValue placeholder="English" />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_LANGUAGES.map((option) => (
                  <SelectItem key={option.code} value={option.code}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="tokenise-model">Tokenizer model</Label>
            <Input
              id="tokenise-model"
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                setModelUserSet(true);
              }}
              placeholder={recommendedModelForLanguage}
            />
            <p className="text-xs text-muted-foreground">
              Defaults to the recommended model for the chosen language
              (currently <code>{recommendedModelForLanguage}</code>). HuggingFace
              model IDs or the special <code>jieba</code> backend are accepted.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} type="button">
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Tokenising…
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Tokenise
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default TokeniseDialog;
