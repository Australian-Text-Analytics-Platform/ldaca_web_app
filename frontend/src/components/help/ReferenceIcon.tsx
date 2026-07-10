import { DocLinkIcon } from './DocLinkIcon';
import type { DocumentKey } from '@/tutorials/documentationRegistry';

interface ReferenceIconProps {
  targetKey: DocumentKey<'reference'>;
  label?: string;
  tooltip?: string;
  className?: string;
}

/**
 * Reference icon wrapper used by citation/reference affordances to open reference docs.
 * Why: callers need a focused rendering boundary for layout, accessibility, and state handoff.
 */
function ReferenceIcon(props: ReferenceIconProps) {
  return <DocLinkIcon kind="reference" {...props} />;
}

export default ReferenceIcon;
