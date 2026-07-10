import { lazy, Suspense } from 'react';

import { useUIStore } from '@/stores';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import type { DocLinkKind } from '@/tutorials/documentationRegistry';

/** Lazy document viewer chunk shared by every help/info/reference target. */
const DocumentView = lazy(() => import('@/components/DocumentView'));

const DIALOG_CONTENT_CLASS = 'max-w-5xl h-[85vh] flex flex-col p-0 gap-0 overflow-hidden';
const FALLBACK_BASE = 'p-8 flex items-center justify-center h-full';

const DOCUMENT_PRESENTATION: Record<
  DocLinkKind,
  {
    docType: 'tutorial' | 'information' | 'reference';
    title: string;
    spinnerColor: string;
  }
> = {
  tutorial: {
    docType: 'tutorial',
    title: 'Tutorial',
    spinnerColor: 'border-blue-600',
  },
  info: {
    docType: 'information',
    title: 'Information',
    spinnerColor: 'border-blue-500',
  },
  reference: {
    docType: 'reference',
    title: 'Reference',
    spinnerColor: 'border-emerald-600',
  },
};

/**
 * Hosts the single document dialog for tutorial, information, and reference
 * targets. The canonical target carries its kind through registry lookup and
 * UI intent, so switching targets never requires parallel modal slots.
 *
 * Rendered by: `WorkspaceShell` so every documentation affordance shares one
 * lazy viewer, focus trap, close action, and target lifecycle.
 */
export function DocumentModalHost() {
  const target = useUIStore((state) => state.documentTarget);
  const closeDocument = useUIStore((state) => state.closeDocument);
  const presentation = target ? DOCUMENT_PRESENTATION[target.kind] : null;

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) closeDocument();
      }}
    >
      <DialogContent className={DIALOG_CONTENT_CLASS} aria-describedby={undefined}>
        <DialogTitle className="sr-only">{presentation?.title ?? 'Documentation'}</DialogTitle>
        <div className="flex-1 overflow-y-auto">
          {target && presentation ? (
            <Suspense
              fallback={
                <div className={FALLBACK_BASE}>
                  <div
                    className={`animate-spin rounded-full h-8 w-8 border-b-2 ${presentation.spinnerColor}`}
                  />
                </div>
              }
            >
              <DocumentView
                docType={presentation.docType}
                onClose={closeDocument}
                target={target}
              />
            </Suspense>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
