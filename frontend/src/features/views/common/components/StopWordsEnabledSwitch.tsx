interface Props {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
}

/** Shared enablement primitive; each analysis owns its feature-specific editor. */
export function StopWordsEnabledSwitch({
  checked,
  onCheckedChange,
  label = 'Enable stop words',
}: Props) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <Switch size="sm" checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
      {label}
    </label>
  );
}
import { Switch } from '@/components/ui/switch';
