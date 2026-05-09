import React from 'react';
import { DocLinkIcon } from './DocLinkIcon';
import type { ReferenceTargetKey } from '@/tutorials/referenceRegistry';

export interface ReferenceIconProps {
  targetKey: ReferenceTargetKey | (string & {});
  label?: string;
  tooltip?: string;
  className?: string;
}

const ReferenceIcon: React.FC<ReferenceIconProps> = (props) => <DocLinkIcon kind="reference" {...props} />;

export default ReferenceIcon;
