import React from 'react';
import { Camera } from 'lucide-react';
import { DropdownMenuCheckboxItem } from '@/components/ui/dropdown-menu';
import { usePreferencesStore } from '@/stores/preferencesStore';

/**
 * Sidebar menu entry: toggles the demo-snapshot master switch. When
 * off, every analytic tool's Save/Load button is unmounted via the
 * shared <AnalysisFeatureHeader>. When on, the buttons appear in
 * each tool's title row. Default off.
 *
 * Plan §3.6. Sibling of "Reset all hints" / "Clear embedding cache"
 * in the sidebar dropdown menu.
 */
export const DemoSnapshotsToggleItem: React.FC = () => {
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
};
