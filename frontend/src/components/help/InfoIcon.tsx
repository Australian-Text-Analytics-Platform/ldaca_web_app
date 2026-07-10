import { DocLinkIcon } from './DocLinkIcon';
import type { DocumentKey } from '@/tutorials/documentationRegistry';

interface InfoIconProps {
  targetKey: DocumentKey<'info'>;
  label?: string;
  tooltip?: string;
  className?: string;
}

/**
 * Information icon wrapper used by app chrome to open informational documentation anchors.
 * Why: callers need a focused rendering boundary for layout, accessibility, and state handoff.
 */
function InfoIcon(props: InfoIconProps) {
  return <DocLinkIcon kind="info" {...props} />;
}

export default InfoIcon;
