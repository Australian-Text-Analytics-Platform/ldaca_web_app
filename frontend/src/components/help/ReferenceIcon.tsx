import { DocLinkIcon } from './DocLinkIcon';
import type { DocumentKey } from '@/tutorials/documentationRegistry';

interface ReferenceIconProps {
  targetKey: DocumentKey<'reference'>;
  label?: string;
  tooltip?: string;
  className?: string;
  iconClassName?: string;
}

/**
 * Reference icon wrapper used by citation/reference affordances to open reference docs.
 */
function ReferenceIcon(props: ReferenceIconProps) {
  return <DocLinkIcon kind="reference" {...props} />;
}

export default ReferenceIcon;
