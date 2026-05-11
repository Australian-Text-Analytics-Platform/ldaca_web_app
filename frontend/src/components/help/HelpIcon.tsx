import React from 'react';
import { DocLinkIcon } from './DocLinkIcon';
import type { TutorialTargetKey } from '@/tutorials/tutorialRegistry';

/**
 * `LooseAutoComplete` keeps IntelliSense suggestions for known target keys
 * while still allowing dynamic strings (e.g. when the icon is rendered
 * inside a HelpConfig pass-through chain). Replace with the bare union
 * once all dynamic call sites have been narrowed.
 */
export interface HelpIconProps {
  targetKey: TutorialTargetKey | (string & {});
  label?: string;
  tooltip?: string;
  className?: string;
}

const HelpIcon: React.FC<HelpIconProps> = (props) => <DocLinkIcon kind="tutorial" {...props} />;

export default HelpIcon;
