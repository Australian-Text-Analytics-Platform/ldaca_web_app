import React from 'react';
import { DocLinkIcon } from './DocLinkIcon';

export interface InfoIconProps {
  targetKey: string;
  label?: string;
  tooltip?: string;
  className?: string;
}

const InfoIcon: React.FC<InfoIconProps> = (props) => <DocLinkIcon kind="info" {...props} />;

export default InfoIcon;
