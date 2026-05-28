import { type FC } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { SURVEY_BASE_URL, buildSurveyUrl, captureFeedbackContext } from '../feedbackContext';

interface FeedbackPanelProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Feedback survey modal opened from the sidebar footer. It builds a contextual
 * Qualtrics URL only while visible so the embedded survey receives the current
 * view, deployment, build, and auth role at the moment of submission.
 * Rendered by: App when the global feedback modal opens so survey metadata reflects the current user role and view.
 * Flow: capture feedback context while open, build the Qualtrics iframe URL, then render the survey or a closed-state placeholder.
 */
export const FeedbackPanel: FC<FeedbackPanelProps> = ({ open, onClose }) => {
  const { isAuthenticated } = useAuth();

  const surveyUrl = open
    ? buildSurveyUrl(
        SURVEY_BASE_URL,
        captureFeedbackContext({ user_role: isAuthenticated ? 'authenticated' : 'anonymous' }),
      )
    : '';

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent className="w-full max-w-3xl p-0 overflow-hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>Send feedback</DialogTitle>
          <DialogDescription>
            Share ideas, report issues, or suggest improvements.
          </DialogDescription>
        </DialogHeader>
        {surveyUrl ? (
          <iframe src={surveyUrl} title="Feedback survey" className="h-[80vh] w-full border-0" />
        ) : (
          <div className="h-[80vh] w-full" />
        )}
      </DialogContent>
    </Dialog>
  );
};

export default FeedbackPanel;
