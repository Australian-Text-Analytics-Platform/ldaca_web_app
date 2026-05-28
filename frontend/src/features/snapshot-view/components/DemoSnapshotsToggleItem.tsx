import { Camera } from 'lucide-react';
import { DropdownMenuCheckboxItem } from '@/components/ui/dropdown-menu';
import { usePreferencesStore } from '@/stores/preferencesStore';

/**
 * Sidebar menu entry: toggles the demo-snapshot master switch. When
 * off, every analytic tool's Save/Load button is unmounted via the
 * shared <AnalysisFeatureHeader>. When on, the buttons appear in
 * each tool's title row. Default off.
 *
 * Sibling of "Reset all hints" / "Clear embedding cache" in the sidebar
 * dropdown menu.
 * Rendered by: Sidebar component, index module, DemoSnapshotsToggleItem tests (rg call sites/imports).
 * Why: because the sidebar needs a menu item that toggles demo snapshot mode without changing the current workspace route.
 */
export function DemoSnapshotsToggleItem() {
  const enabled = usePreferencesStore((s) => s.demoSnapshotsEnabled);
  const setEnabled = usePreferencesStore((s) => s.setDemoSnapshotsEnabled);

  return (
    <DropdownMenuCheckboxItem
      checked={enabled}
      onSelect={(event) => {
        event.preventDefault();
        setEnabled(!enabled);
      }}
      className="text-xs"
    >
      <Camera className="mr-2 h-3.5 w-3.5" />
      Enable demo snapshots
    </DropdownMenuCheckboxItem>
  );
}
