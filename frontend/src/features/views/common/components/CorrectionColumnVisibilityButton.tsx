import { Eye, EyeOff } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface CorrectionColumnVisibilityButtonProps {
  visible: boolean;
  onVisibleChange: (visible: boolean) => void;
}

/** Toggles the configured correction column without changing its stored values. */
export function CorrectionColumnVisibilityButton({
  visible,
  onVisibleChange,
}: CorrectionColumnVisibilityButtonProps) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        onVisibleChange(!visible);
      }}
    >
      {visible ? (
        <EyeOff data-icon="inline-start" aria-hidden="true" />
      ) : (
        <Eye data-icon="inline-start" aria-hidden="true" />
      )}
      {visible ? 'Hide correction' : 'Show correction'}
    </Button>
  );
}
