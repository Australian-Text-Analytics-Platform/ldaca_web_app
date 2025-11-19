import React, { useCallback, useState } from 'react';
import { submitFeedback } from '../../api/feedback';
import { useAuth } from '../../hooks/useAuth';
import { Dialog, DialogContent } from '../ui/dialog';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Loader2 } from 'lucide-react';

interface FeedbackPanelProps {
  open: boolean;
  onClose: () => void;
}

export const FeedbackPanel: React.FC<FeedbackPanelProps> = ({ open, onClose }) => {
  const { isAuthenticated, getAuthHeaders } = useAuth();
  const [subject, setSubject] = useState('');
  const [email, setEmail] = useState('');
  const [comments, setComments] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  const reset = useCallback(() => {
    setSubject('');
    setEmail('');
    setComments('');
    setResultMsg(null);
  }, []);

  const handleCancel = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!subject.trim() || !comments.trim()) {
        setResultMsg('Subject and comments are required.');
        return;
      }

      setSubmitting(true);
      try {
        const response = await submitFeedback(
          { subject, comments, email: email.trim() || undefined },
          isAuthenticated ? getAuthHeaders() : {}
        );
        setResultMsg(response.message || 'Submitted.');
        if (response.success) {
          setTimeout(() => {
            reset();
            onClose();
          }, 1200);
        }
      } catch (error: unknown) {
        const fallback = 'Failed to submit feedback';
        if (typeof error === 'object' && error && 'response' in error) {
          const maybeResponse = (error as { response?: { data?: { detail?: string } } }).response;
          setResultMsg(maybeResponse?.data?.detail || fallback);
        } else {
          setResultMsg(fallback);
        }
      } finally {
        setSubmitting(false);
      }
    },
    [subject, comments, email, isAuthenticated, getAuthHeaders, reset, onClose]
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          handleCancel();
        }
      }}
    >
      <DialogContent className="w-full max-w-xl border-none bg-transparent p-0 shadow-none">
        <form onSubmit={handleSubmit}>
          <Card>
            <CardHeader>
              <CardTitle>Send Feedback</CardTitle>
              <CardDescription>Share ideas, report issues, or suggest improvements.</CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Subject<span className="text-destructive">*</span>
                </label>
                <input
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
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
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Comments<span className="text-destructive">*</span>
                </label>
                <textarea
                  value={comments}
                  onChange={(event) => setComments(event.target.value)}
                  className="h-32 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="Describe your issue, idea, or feedback..."
                  required
                />
              </div>
              {resultMsg && (
                <div className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-foreground">{resultMsg}</div>
              )}
            </CardContent>

            <CardFooter className="flex flex-col gap-2 border-t border-border/70 pt-4">
              <div className="flex w-full items-center justify-end gap-2">
                <Button type="button" variant="outline" onClick={handleCancel}>
                  Cancel
                </Button>
                <Button disabled={submitting} type="submit">
                  {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Submit
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Stored securely. We may reply if you provide an email.</p>
            </CardFooter>
          </Card>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default FeedbackPanel;
