import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { useFilePreview } from '../hooks/useFilePreview';
import { SUPPORTED_LANGUAGES } from '@/lib/languages';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { FilePreviewContent } from './FilePreviewContent';
import { CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog } from '@/components/ui/dialog';

interface AddFilePanelProps {
  filename: string | null;
  open: boolean;
  onClose: () => void;
  onConfirm: (selectedSheet?: string | null) => Promise<void> | void;
}

/**
 * Confirmation dialog opened by the data loader before a selected file becomes
 * a workspace block. It gates rendering on a filename so preview hooks only run
 * for an actual file chosen by the uploader.
 * Rendered by: DataLoaderFeature when a pending upload needs confirmation.
 * Flow: combine open state with filename presence, mirror close events to the
 * caller, then mount the dialog content only for a concrete file.
 */
export function AddFilePanel({ filename, open, onClose, onConfirm }: AddFilePanelProps) {
  const isOpen = open && Boolean(filename);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      {isOpen && filename && (
        <AddFilePanelBody filename={filename} onClose={onClose} onConfirm={onConfirm} />
      )}
    </Dialog>
  );
}

/**
 * File-add dialog body. Shows preview rows, optional Excel sheet selection,
 * and corpus language defaults before delegating the actual add operation
 * back to the data-loader feature via FilePreviewContent.
 */
function AddFilePanelBody({
  filename,
  onClose,
  onConfirm,
}: Omit<AddFilePanelProps, 'open'> & { filename: string }) {
  const {
    previewData,
    columns,
    loading,
    error,
    fileType,
    sheetNames,
    selectedSheet,
    setSelectedSheet,
  } = useFilePreview(filename, true);

  const defaultLanguage = usePreferencesStore((state) => state.defaultLanguage);
  const setDefaultLanguage = usePreferencesStore((state) => state.setDefaultLanguage);
  const selectedLanguage = defaultLanguage ?? 'en';
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async () => {
    try {
      setSubmitting(true);
      await onConfirm(selectedSheet);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const languageSelector = (
    <div>
      <label htmlFor="add-file-language" className="mb-2 block text-sm font-medium text-foreground">
        Language
      </label>
      <Select value={selectedLanguage} onValueChange={setDefaultLanguage}>
        <SelectTrigger id="add-file-language" aria-label="Corpus language">
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
      <p className="mt-1 text-xs text-muted-foreground">
        Sets the default for this and future corpora. Analysis tools without a language-specific
        implementation (e.g. quotation extractor) will disable themselves on non-English corpora.
      </p>
    </div>
  );

  const footer = (
    <CardFooter className="border-t px-6 py-4">
      <div className="flex w-full items-center justify-end gap-2">
        <Button variant="outline" onClick={onClose} type="button">
          Cancel
        </Button>
        <Button size="sm" onClick={() => {
          void handleConfirm();
        }} disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Adding…
            </>
          ) : (
            <>
              <Plus className="mr-2 h-4 w-4" />
              Add to Workspace
            </>
          )}
        </Button>
      </div>
    </CardFooter>
  );

  return (
    <FilePreviewContent
      filename={filename}
      open
      onClose={onClose}
      data={{
        previewData,
        columns,
        loading,
        error,
        fileType,
        sheetNames,
        selectedSheet,
        setSelectedSheet,
      }}
      title={`Add File: ${filename}`}
      description="Files are added as data blocks automatically. Choose an optional sheet, inspect the preview, and confirm before adding it to the workspace."
      headerSlot={languageSelector}
      footer={footer}
    />
  );
}

export default AddFilePanel;
