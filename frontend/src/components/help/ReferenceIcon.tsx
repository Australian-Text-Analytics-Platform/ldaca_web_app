import React from 'react';
import { DocLinkIcon } from './DocLinkIcon';

export interface ReferenceIconProps {
  targetKey: string;
  label?: string;
  tooltip?: string;
  className?: string;
}

const ReferenceIcon: React.FC<ReferenceIconProps> = (props) => <DocLinkIcon kind="reference" {...props} />;

export default ReferenceIcon;
