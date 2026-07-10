import { lazy, Suspense } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { Toaster } from '@/components/ui/sonner';
import { useUIStore } from '@/stores/uiStore';
import { DocsEolBanner } from '@/tutorials/DocsEolBanner';

const FeedbackPanel = lazy(() =>
  import('@/features/feedback/components/FeedbackPanel').then((module) => ({
    default: module.FeedbackPanel,
  })),
);

/**
 * Mounts the application-wide overlay/notification hosts exactly once.
 *
 * Rendered by: `App`, outside backend and auth branches, so startup, login,
 * workspace, and failure screens share one feedback panel, docs banner, and
 * toast queue.
 */
export function GlobalHosts() {
  const { feedbackOpen, closeFeedback } = useUIStore(
    useShallow((state) => ({
      feedbackOpen: state.feedbackOpen,
      closeFeedback: state.closeFeedback,
    })),
  );

  return (
    <>
      <Suspense fallback={null}>
        <FeedbackPanel
          open={feedbackOpen}
          onClose={() => {
            closeFeedback();
          }}
        />
      </Suspense>
      <DocsEolBanner />
      <Toaster />
    </>
  );
}
