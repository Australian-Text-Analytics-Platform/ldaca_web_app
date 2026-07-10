import { Loader2 } from 'lucide-react';

import { Tag } from '@/components/ui/tag';

interface Props {
  /** Whether the operation is currently running. */
  active: boolean;
  /**
   * Verb shown in the chip while running, e.g. "Adding", "Joining",
   * "Concatenating". The trailing ellipsis is appended automatically.
   */
  verb: string;
}

/**
 * Header chip rendered while a sub-tab's apply mutation is in flight.
 * Replaces a near-identical `<Tag tone="muted"><Loader2 .../>{verb}…</Tag>`
 * snippet that lived in 7 sub-tab components.
 * Rendered in preprocessing sub-tab headers to distinguish configured tabs.
 */
export function SubTabActivityTag({ active, verb }: Props) {
  if (!active) return null;
  return (
    <Tag tone="muted">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      {verb}…
    </Tag>
  );
}
