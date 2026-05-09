import React from 'react';
import { DocLinkIcon } from './DocLinkIcon';

export interface HelpIconProps {
  targetKey: string;
  label?: string;
  tooltip?: string;
  className?: string;
}

const HelpIcon: React.FC<HelpIconProps> = (props) => <DocLinkIcon kind="tutorial" {...props} />;

export default HelpIcon;
