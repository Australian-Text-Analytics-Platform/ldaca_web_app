import { lazy, Suspense } from 'react';

import { useUIStore } from '@/stores';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

/** Lazy document viewer chunk shared by all help/reference modal slots. */
const DocumentView = lazy(() => import('@/components/DocumentView'));

/** Shared modal sizing for document viewers opened from help/reference icons. */
const DIALOG_CONTENT_CLASS = 'max-w-5xl h-[85vh] flex flex-col p-0 gap-0 overflow-hidden';
/** Shared Suspense fallback layout used while the markdown viewer chunk loads. */
const FALLBACK_BASE = 'p-8 flex items-center justify-center h-full';

interface ModalSlotProps {
  open: boolean;
  onClose: () => void;
  target: { file: string; anchor: string; label?: string } | null | undefined;
  docType: 'tutorial' | 'warning' | 'information' | 'reference';
  title: string;
  /** Tailwind colour for the spinner ring used by the Suspense fallback. */
  spinnerColor: string;
}

/**
 * Single document-dialog slot used by `DocumentModalHost` for each help content
 * type. It keeps the lazy `DocumentView` wiring identical across tutorial,
 * warning, information, and reference modals.
 * Why: every document modal should share the same lazy viewer chrome while differing only by target and colour.
 * Flow: open the dialog, render the hidden title, lazy-load DocumentView, then show the spinner fallback until the chunk is ready.
 */
function ModalSlot({ open, onClose, target, docType, title, spinnerColor }: ModalSlotProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className={DIALOG_CONTENT_CLASS}>
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <div className="flex-1 overflow-y-auto">
          <Suspense
            fallback={
              <div className={FALLBACK_BASE}>
                <div className={`animate-spin rounded-full h-8 w-8 border-b-2 ${spinnerColor}`} />
              </div>
            }
          >
            <DocumentView docType={docType} onClose={onClose} target={target} />
          </Suspense>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Hosts the four lazy-loaded help/info/warning/reference modals for the app
 * shell. It reads primitive `useUIStore` fields separately so icon triggers can
 * open documentation without reintroducing nested selector identity loops.
 * Rendered by: App next to the workspace shell so help icons can open one of four modal targets without mounting viewers eagerly.
 * Flow: read modal open states, targets, and close actions from UI store, then render one ModalSlot for each document type.
 */
export function DocumentModalHost() {
  const tutorialModal = useUIStore((s) => s.modals.tutorial);
  const warningModal = useUIStore((s) => s.modals.warning);
  const infoModal = useUIStore((s) => s.modals.info);
  const referenceModal = useUIStore((s) => s.modals.reference);
  const tutorialTarget = useUIStore((s) => s.modalTargets.tutorial);
  const warningTarget = useUIStore((s) => s.modalTargets.warning);
  const infoTarget = useUIStore((s) => s.modalTargets.info);
  const referenceTarget = useUIStore((s) => s.modalTargets.reference);
  const closeTutorial = () => useUIStore.getState().closeModal('tutorial');
  const closeWarning = () => useUIStore.getState().closeModal('warning');
  const closeInfo = () => useUIStore.getState().closeModal('info');
  const closeReference = () => useUIStore.getState().closeModal('reference');

  return (
    <>
      <ModalSlot
        open={tutorialModal}
        onClose={closeTutorial}
        target={tutorialTarget}
        docType="tutorial"
        title="Tutorial"
        spinnerColor="border-blue-600"
      />
      <ModalSlot
        open={warningModal}
        onClose={closeWarning}
        target={warningTarget}
        docType="warning"
        title="Warning"
        spinnerColor="border-amber-500"
      />
      <ModalSlot
        open={infoModal}
        onClose={closeInfo}
        target={infoTarget}
        docType="information"
        title="Information"
        spinnerColor="border-blue-500"
      />
      <ModalSlot
        open={referenceModal}
        onClose={closeReference}
        target={referenceTarget}
        docType="reference"
        title="Reference"
        spinnerColor="border-emerald-600"
      />
    </>
  );
}
