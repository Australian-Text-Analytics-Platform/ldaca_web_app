import React, { lazy, Suspense } from 'react';

import { useUIStore } from '@/stores';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

const DocumentView = lazy(() => import('@/components/DocumentView'));

const DIALOG_CONTENT_CLASS = 'max-w-5xl h-[85vh] flex flex-col p-0 gap-0 overflow-hidden';
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

const ModalSlot: React.FC<ModalSlotProps> = ({ open, onClose, target, docType, title, spinnerColor }) => (
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

/**
 * Renders the four lazy-loaded help/info/warning/reference modals,
 * each gated by its own bit in `useUIStore.modals`. Replaces four
 * near-identical `<Dialog>` blocks that lived in App.tsx.
 *
 * Each store field is read with a stable primitive selector so this
 * component only re-renders when one of those primitives actually
 * changes. (An earlier `useShallow` selector returning nested objects
 * returned a new identity every render and caused an infinite loop.)
 */
export const DocumentModalHost: React.FC = () => {
  const tutorialModal = useUIStore((s) => s.modals.tutorialModal);
  const warningModal = useUIStore((s) => s.modals.warningModal);
  const infoModal = useUIStore((s) => s.modals.infoModal);
  const referenceModal = useUIStore((s) => s.modals.referenceModal);
  const tutorialTarget = useUIStore((s) => s.tutorialTarget);
  const warningTarget = useUIStore((s) => s.warningTarget);
  const infoTarget = useUIStore((s) => s.infoTarget);
  const referenceTarget = useUIStore((s) => s.referenceTarget);
  const closeTutorialModal = useUIStore((s) => s.closeTutorialModal);
  const closeWarningModal = useUIStore((s) => s.closeWarningModal);
  const closeInfoModal = useUIStore((s) => s.closeInfoModal);
  const closeReferenceModal = useUIStore((s) => s.closeReferenceModal);

  return (
    <>
      <ModalSlot
        open={tutorialModal}
        onClose={closeTutorialModal}
        target={tutorialTarget}
        docType="tutorial"
        title="Tutorial"
        spinnerColor="border-blue-600"
      />
      <ModalSlot
        open={warningModal}
        onClose={closeWarningModal}
        target={warningTarget}
        docType="warning"
        title="Warning"
        spinnerColor="border-amber-500"
      />
      <ModalSlot
        open={infoModal}
        onClose={closeInfoModal}
        target={infoTarget}
        docType="information"
        title="Information"
        spinnerColor="border-blue-500"
      />
      <ModalSlot
        open={referenceModal}
        onClose={closeReferenceModal}
        target={referenceTarget}
        docType="reference"
        title="Reference"
        spinnerColor="border-emerald-600"
      />
    </>
  );
};
