import React from 'react';
import { DocLinkIcon } from './DocLinkIcon';
import type { InfoTargetKey } from '@/tutorials/infoRegistry';

export interface InfoIconProps {
  targetKey: InfoTargetKey | (string & {});
  label?: string;
  tooltip?: string;
  className?: string;
}

/**
 * Information icon wrapper used by app chrome to open informational documentation anchors.
 * Why: callers need a focused rendering boundary for layout, accessibility, and state handoff.
 */
const InfoIcon: React.FC<InfoIconProps> = (props) => <DocLinkIcon kind="info" {...props} />;

export default InfoIcon;
