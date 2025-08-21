import React, { useState } from 'react';
import { submitFeedback } from '../api';
import { useAuth } from '../hooks/useAuth';

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

  if (!isOpen) return null;

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-lg">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">Send Feedback</h3>
          <button onClick={() => { reset(); onClose(); }} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Subject<span className="text-red-500">*</span></label>
            <input value={subject} onChange={e => setSubject(e.target.value)} className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Short summary" maxLength={120} required />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Email (optional)</label>
            <input value={email} onChange={e => setEmail(e.target.value)} className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="you@example.com" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Comments<span className="text-red-500">*</span></label>
            <textarea value={comments} onChange={e => setComments(e.target.value)} className="w-full border rounded px-3 py-2 text-sm h-32 resize-y focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Describe your issue, idea, or feedback..." required />
          </div>
          {resultMsg && (
            <div className="text-sm text-gray-700 bg-gray-50 border rounded px-3 py-2">{resultMsg}</div>
          )}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={() => { reset(); onClose(); }} className="px-4 py-2 text-sm rounded border bg-white hover:bg-gray-50">Cancel</button>
            <button disabled={submitting} type="submit" className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
              {submitting && <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />}
              Submit
            </button>
          </div>
          <p className="text-xs text-gray-400">Stored securely. We may reply if you provide an email.</p>
        </form>
      </div>
    </div>
  );
};

export default FeedbackModal;
