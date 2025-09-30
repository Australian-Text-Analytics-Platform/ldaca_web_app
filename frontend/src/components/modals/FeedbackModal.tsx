import React, { useState } from 'react';
import { submitFeedback } from '../../api/feedback';
import { useAuth } from '../../hooks/useAuth';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Loader2 } from 'lucide-react';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const FeedbackModal: React.FC<FeedbackModalProps> = ({ isOpen, onClose }) => {
  const { isAuthenticated, getAuthHeaders } = useAuth();
  const [subject, setSubject] = useState('');
  const [email, setEmail] = useState('');
  const [comments, setComments] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  const reset = () => {
    setSubject('');
    setEmail('');
    setComments('');
    setResultMsg(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !comments.trim()) {
      setResultMsg('Subject and comments are required.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await submitFeedback({ subject, comments, email: email.trim() || undefined }, isAuthenticated ? getAuthHeaders() : {});
      setResultMsg(res.message || 'Submitted.');
      if (res.success) {
        setTimeout(() => {
          reset();
          onClose();
        }, 1200);
      }
    } catch (err: any) {
      setResultMsg(err?.response?.data?.detail || 'Failed to submit feedback');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && (reset(), onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send Feedback</DialogTitle>
          <DialogDescription>
            Share your ideas, report issues, or suggest improvements.
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Subject<span className="text-destructive">*</span></label>
            <input 
              value={subject} 
              onChange={e => setSubject(e.target.value)} 
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" 
              placeholder="Short summary" 
              maxLength={120} 
              required 
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Email (optional)</label>
            <input 
              value={email} 
              onChange={e => setEmail(e.target.value)} 
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" 
              placeholder="you@example.com" 
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Comments<span className="text-destructive">*</span></label>
            <textarea 
              value={comments} 
              onChange={e => setComments(e.target.value)} 
              className="h-32 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" 
              placeholder="Describe your issue, idea, or feedback..." 
              required 
            />
          </div>
          {resultMsg && (
            <div className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-foreground">{resultMsg}</div>
          )}
          
          <DialogFooter>
            <div className="w-full">
              <div className="flex items-center justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
                <Button disabled={submitting} type="submit">
                  {submitting && <Loader2 className="animate-spin" />}
                  Submit
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">Stored securely. We may reply if you provide an email.</p>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default FeedbackModal;
