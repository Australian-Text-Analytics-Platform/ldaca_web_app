import { type FC } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { useAuth } from '../../hooks/useAuth';
import { SURVEY_BASE_URL, buildSurveyUrl, captureFeedbackContext } from './feedbackContext';

interface FeedbackPanelProps {
  open: boolean;
  onClose: () => void;
}

export const FeedbackPanel: FC<FeedbackPanelProps> = ({ open, onClose }) => {
  const { isAuthenticated } = useAuth();

  const surveyUrl = open
    ? buildSurveyUrl(
        SURVEY_BASE_URL,
        captureFeedbackContext({ user_role: isAuthenticated ? 'authenticated' : 'anonymous' }),
      )
    : '';

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="w-full max-w-3xl p-0 overflow-hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>Send feedback</DialogTitle>
          <DialogDescription>Share ideas, report issues, or suggest improvements.</DialogDescription>
        </DialogHeader>
        {surveyUrl ? (
          <iframe
            src={surveyUrl}
            title="Feedback survey"
            className="h-[80vh] w-full border-0"
          />
        ) : (
          <div className="h-[80vh] w-full" />
        )}
      </DialogContent>
    </Dialog>
  );
};

export default FeedbackPanel;
