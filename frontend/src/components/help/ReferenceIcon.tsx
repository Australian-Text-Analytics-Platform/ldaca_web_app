import React from 'react';
import { DocLinkIcon } from './DocLinkIcon';
import type { ReferenceTargetKey } from '@/tutorials/referenceRegistry';

export interface ReferenceIconProps {
  targetKey: ReferenceTargetKey | (string & {});
  label?: string;
  tooltip?: string;
  className?: string;
}

/**
 * Reference icon wrapper used by citation/reference affordances to open reference docs.
 * Why: callers need a focused rendering boundary for layout, accessibility, and state handoff.
 */
const ReferenceIcon: React.FC<ReferenceIconProps> = (props) => <DocLinkIcon kind="reference" {...props} />;

export default ReferenceIcon;
