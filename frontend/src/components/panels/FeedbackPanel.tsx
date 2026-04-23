import type React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';

interface FeedbackPanelProps {
  open: boolean;
  onClose: () => void;
}

const SURVEY_URL = 'https://sydney.au1.qualtrics.com/jfe/form/SV_dcZ4HVzI2vsEysC';

export const FeedbackPanel: React.FC<FeedbackPanelProps> = ({ open, onClose }) => {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="w-full max-w-3xl p-0 overflow-hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>Send feedback</DialogTitle>
          <DialogDescription>Share ideas, report issues, or suggest improvements.</DialogDescription>
        </DialogHeader>
        <iframe
          src={SURVEY_URL}
          title="Feedback survey"
          className="h-[80vh] w-full border-0"
        />
      </DialogContent>
    </Dialog>
  );
};

export default FeedbackPanel;