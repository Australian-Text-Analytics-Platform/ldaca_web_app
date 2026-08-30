import { DocLinkIcon } from './DocLinkIcon';
import type { DocumentKey } from '@/tutorials/documentationRegistry';

interface InfoIconProps {
  targetKey: DocumentKey<'info'>;
  label?: string;
  tooltip?: string;
  className?: string;
  iconClassName?: string;
}

/**
 * Information icon wrapper used by app chrome to open informational documentation anchors.
 */
function InfoIcon(props: InfoIconProps) {
  return <DocLinkIcon kind="info" {...props} />;
}

export default InfoIcon;
