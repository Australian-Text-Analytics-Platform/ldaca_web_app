import React from 'react';
import { DocLinkIcon } from './DocLinkIcon';
import type { InfoTargetKey } from '@/tutorials/infoRegistry';

export interface InfoIconProps {
  targetKey: InfoTargetKey | (string & {});
  label?: string;
  tooltip?: string;
  className?: string;
}

const InfoIcon: React.FC<InfoIconProps> = (props) => <DocLinkIcon kind="info" {...props} />;

export default InfoIcon;
