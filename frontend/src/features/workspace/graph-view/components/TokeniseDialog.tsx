/**
 * Phase 4.3: Tokenise action dialog.
 *
 * Picks a source column + language + tokenizer model and POSTs to the
 * tokenisation endpoint. Each node stores one tokenisation spec; saving a
 * new source/model replaces the previous one.
 */
import { useState } from 'react';
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
import { createTokenization } from '@/api/generated/sdk.gen';
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

function getInitialModel(
  defaultLanguage: string | null,
  defaultTokenizerModel: string | null,
): string {
  return defaultTokenizerModel
    ?? findLanguage(defaultLanguage ?? 'en')?.recommendedModel
    ?? 'bert-base-uncased';
}

export function TokeniseDialog({
  open,
  onClose,
  ...formProps
}: TokeniseDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      {open && <TokeniseDialogForm {...formProps} onClose={onClose} />}
    </Dialog>
  );
}

function TokeniseDialogForm({
  onClose,
  nodeId,
  nodeName,
  columns,
  initialColumn,
  onSuccess,
}: Omit<TokeniseDialogProps, 'open'>) {
  const { getAuthHeaders } = useAuth();
  const defaultLanguage = usePreferencesStore((state) => state.defaultLanguage);
  const defaultTokenizerModel = usePreferencesStore(
    (state) => state.defaultTokenizerModel,
  );

  const [sourceColumn, setSourceColumn] = useState<string>(
    initialColumn ?? pickDefaultColumn(columns) ?? '',
  );
  const [language, setLanguage] = useState<string>(defaultLanguage ?? 'en');
  const [model, setModel] = useState<string>(
    () => getInitialModel(defaultLanguage, defaultTokenizerModel),
  );
  const [modelUserSet, setModelUserSet] = useState<boolean>(
    Boolean(defaultTokenizerModel),
  );
  const [submitting, setSubmitting] = useState(false);

  const languageOption = findLanguage(language);
  const recommendedModelForLanguage = languageOption?.recommendedModel ?? 'bert-base-uncased';
  const dictOptions = languageOption?.availableDicts && languageOption.availableDicts.length > 1
    ? languageOption.availableDicts
    : null;
  const selectedDictModel = dictOptions?.find((dict) => dict.model === model.trim())?.model ?? null;

  const handleLanguageChange = (next: string) => {
    setLanguage(next);
    if (!modelUserSet) {
      const recommended = findLanguage(next)?.recommendedModel;
      if (recommended) setModel(recommended);
    }
  };

  const handleDictChange = (nextModel: string) => {
    setModel(nextModel);
    // Dict picks aren't a "user-set custom model" — they're still a
    // recommended default for the language. Keep modelUserSet=false so a
    // subsequent language change re-applies the new language's default.
  };

  const canSubmit =
    Boolean(sourceColumn) && Boolean(model.trim()) && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const { data: result } = await createTokenization({
        body: {
          source_column: sourceColumn,
          model: model.trim(),
          language: language || null,
        },
        headers: getAuthHeaders(),
        path: { node_id: nodeId },
        throwOnError: true,
      });
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
    <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-indigo-600" aria-hidden />
            Tokenise “{nodeName}”
          </DialogTitle>
          <DialogDescription>
            Records the source column and tokeniser model for this node. A
            new selection replaces the previous tokenisation setting.
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

          {dictOptions && (
            <div className="space-y-1">
              <Label htmlFor="tokenise-dict">Dictionary</Label>
              <Select
                value={selectedDictModel ?? ''}
                onValueChange={handleDictChange}
              >
                <SelectTrigger id="tokenise-dict" aria-label="Morpheme dictionary">
                  <SelectValue placeholder="Pick a dictionary" />
                </SelectTrigger>
                <SelectContent>
                  {dictOptions.map((dict) => (
                    <SelectItem key={dict.model} value={dict.model}>
                      {dict.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

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
              model IDs, the special <code>jieba</code> backend, or
              {' '}
              <code>lindera-ja-ipadic</code>/<code>lindera-ja-unidic</code>/
              <code>lindera-ko-dic</code> are accepted.
            </p>
            {languageOption?.firstUseHint && (
              <p className="text-xs text-muted-foreground italic">
                {languageOption.firstUseHint}
              </p>
            )}
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
  );
}

export default TokeniseDialog;
