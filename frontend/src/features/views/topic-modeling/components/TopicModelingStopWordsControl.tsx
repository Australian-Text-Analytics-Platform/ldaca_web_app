import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { StopWordsEnabledSwitch } from '@/features/views/common/components/StopWordsEnabledSwitch';
import { useDetectedColumnLanguage } from '@/features/views/common/hooks/useDetectedColumnLanguage';
import { formatStopWords, parseStopWordsText } from '@/features/views/common/utils/stopWords';
import { listSupportedStopwordLanguages, loadMergedStopwords } from '@/lib/loadMergedStopwords';

const SAVED_LIST_VALUE = '__saved__';
const CLEAR_LIST_VALUE = '__clear__';
const EMPTY_PROMPT_VALUE = '__prompt__';

interface TopicModelingStopWordsControlProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  savedWords: string[];
  workspaceId: string | null;
  nodeId: string | null;
  column: string | null;
  onSavedWordsChange: (words: string[]) => Promise<void>;
}

/**
 * Edits and applies the active Topic Tab's saved stop words without changing
 * the immutable Result. Language rows replace the saved list; the switch only
 * controls whether that list participates in the current Result projection.
 */
export function TopicModelingStopWordsControl({
  enabled,
  onEnabledChange,
  savedWords,
  workspaceId,
  nodeId,
  column,
  onSavedWordsChange,
}: TopicModelingStopWordsControlProps) {
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [isLoadingLanguage, setIsLoadingLanguage] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorDraft, setEditorDraft] = useState('');
  const [isSavingEditor, setIsSavingEditor] = useState(false);
  const languages = listSupportedStopwordLanguages();
  const { detectedLanguage } = useDetectedColumnLanguage({
    workspaceId,
    nodeId,
    column,
    enabled: languageMenuOpen,
  });
  const recommendedLanguage = languages.find((language) => language.iso6391 === detectedLanguage);
  const remainingLanguages = languages
    .filter((language) => language.iso6391 !== recommendedLanguage?.iso6391)
    .sort((left, right) => left.name.localeCompare(right.name));
  const hasSavedWords = savedWords.length > 0;
  const savedListLabel = `Saved list (${String(savedWords.length)} words)`;
  const isPending = isLoadingLanguage || isSavingEditor;
  const normalizedEditorWordCount = parseStopWordsText(editorDraft).length;

  const replaceWithLanguage = async (language: string) => {
    setIsLoadingLanguage(true);
    try {
      let merged: string[];
      try {
        ({ merged } = await loadMergedStopwords({ languages: [language] }));
      } catch (cause) {
        toast.error('Failed to load stop words.', {
          description: cause instanceof Error ? cause.message : String(cause),
        });
        return;
      }
      try {
        await onSavedWordsChange(merged);
      } catch {
        // The shared Tab mutation owns rollback, error messaging, and retry.
      }
    } finally {
      setIsLoadingLanguage(false);
    }
  };

  const clearSavedWords = async () => {
    setIsLoadingLanguage(true);
    try {
      await onSavedWordsChange([]);
    } catch {
      // The shared Tab mutation owns rollback, error messaging, and retry.
    } finally {
      setIsLoadingLanguage(false);
    }
  };

  const handleEditorOpenChange = (open: boolean) => {
    if (isSavingEditor) return;
    if (open) setEditorDraft(formatStopWords(savedWords));
    setEditorOpen(open);
  };

  const saveEditor = async () => {
    setIsSavingEditor(true);
    try {
      await onSavedWordsChange(parseStopWordsText(editorDraft));
      setEditorOpen(false);
    } catch {
      // Keep the draft open. The shared mutation presents the retryable error.
    } finally {
      setIsSavingEditor(false);
    }
  };

  return (
    <>
      <div className="flex min-h-8 flex-wrap items-center gap-2">
        <StopWordsEnabledSwitch
          checked={enabled}
          onCheckedChange={onEnabledChange}
          label="Filter stop words"
        />
        <Select
          value={hasSavedWords ? SAVED_LIST_VALUE : EMPTY_PROMPT_VALUE}
          disabled={isPending}
          onOpenChange={setLanguageMenuOpen}
          onValueChange={(value) => {
            if (value === SAVED_LIST_VALUE || value === EMPTY_PROMPT_VALUE) return;
            if (value === CLEAR_LIST_VALUE) {
              void clearSavedWords();
              return;
            }
            void replaceWithLanguage(value);
          }}
        >
          <SelectTrigger
            className="h-9 w-56 max-w-full text-label-secondary"
            aria-label="Stop words language"
          >
            <SelectValue placeholder="Select language" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {hasSavedWords ? (
                <SelectItem value={CLEAR_LIST_VALUE}>Clear stop words</SelectItem>
              ) : (
                <SelectItem value={EMPTY_PROMPT_VALUE} disabled>
                  Select language
                </SelectItem>
              )}
              {hasSavedWords ? (
                <SelectItem value={SAVED_LIST_VALUE}>{savedListLabel}</SelectItem>
              ) : null}
            </SelectGroup>
            <SelectGroup>
              {recommendedLanguage ? (
                <SelectItem value={recommendedLanguage.iso6391}>
                  {recommendedLanguage.name} (Recommended)
                </SelectItem>
              ) : null}
              {remainingLanguages.map((language) => (
                <SelectItem key={language.iso6391} value={language.iso6391}>
                  {language.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Edit stop words"
              disabled={isPending}
              onClick={() => {
                handleEditorOpenChange(true);
              }}
            >
              <Pencil data-icon="inline-start" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Edit stop words</TooltipContent>
        </Tooltip>
      </div>

      <Dialog open={editorOpen} onOpenChange={handleEditorOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit stop words</DialogTitle>
            <DialogDescription>
              Enter words separated by commas or new lines. Saving replaces this Tab&apos;s saved
              list without changing the Topic Result.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="topic-modeling-stop-words">Stop words</Label>
            <Textarea
              id="topic-modeling-stop-words"
              rows={8}
              value={editorDraft}
              disabled={isSavingEditor}
              placeholder="the, and, of"
              onChange={(event) => {
                setEditorDraft(event.target.value);
              }}
            />
            <p className="text-label-secondary text-description">
              {String(normalizedEditorWordCount)} normalized words
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isSavingEditor}
              onClick={() => {
                handleEditorOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={isSavingEditor}
              onClick={() => {
                void saveEditor();
              }}
            >
              {isSavingEditor ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
