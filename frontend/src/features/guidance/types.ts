import type { ReactNode } from 'react';
import type { Step, StepTarget } from 'react-joyride';

export interface ContextualHintDefinition {
  id: string;
  version: number;
  target: StepTarget;
  placement?: Step['placement'];
  title?: ReactNode;
  content: ReactNode;
}

export interface GuidedTourDefinition {
  id: string;
  steps: {
    id: string;
    target: StepTarget;
    title?: ReactNode;
    content: ReactNode;
  }[];
}
