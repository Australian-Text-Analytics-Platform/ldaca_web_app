import React from 'react';
import { DocLinkIcon } from './DocLinkIcon';
import type { TutorialTargetKey } from '@/tutorials/tutorialRegistry';

export interface HelpIconProps {
  targetKey: TutorialTargetKey | (string & {});
  label?: string;
  tooltip?: string;
  className?: string;
}

/**
 * Tutorial help icon wrapper used by feature and layout call sites that open tutorial anchors.
 * Why: callers need a focused rendering boundary for layout, accessibility, and state handoff.
 */
const HelpIcon: React.FC<HelpIconProps> = (props) => <DocLinkIcon kind="tutorial" {...props} />;

export default HelpIcon;
