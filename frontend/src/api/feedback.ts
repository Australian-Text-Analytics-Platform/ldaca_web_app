import { post } from './http';

export interface FeedbackRequestBody {
  subject: string;
  comments: string;
  email?: string;
}

export interface FeedbackResponseBody {
  success: boolean;
  message: string;
  record_id?: string;
  meta?: Record<string, any>;
}

export const feedbackApi = {
  submit: (body: FeedbackRequestBody, headers: Record<string,string> = {}) => post<FeedbackResponseBody>('/feedback/submit', body, headers),
};

// Legacy compatibility name
export const submitFeedback = feedbackApi.submit;
