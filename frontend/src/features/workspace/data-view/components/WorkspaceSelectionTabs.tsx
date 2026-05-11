import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkspaceSelectionTabsState } from '../hooks/useWorkspaceDataTable';

type WorkspaceSelectionTabsProps = WorkspaceSelectionTabsState;

export const WorkspaceSelectionTabs = ({
  shouldShowTabs,
  tabs,
  onTabChange,
  onTabClose,
}: WorkspaceSelectionTabsProps) => {
  if (!shouldShowTabs) {
    return null;
  }

  return (
    <div className="border-b border-border/70 bg-muted/60">
      <div className="flex items-end gap-1 overflow-x-auto px-2 pt-2">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={cn(
              'group flex min-w-[140px] max-w-[240px] items-center rounded-t-md border border-border/60 bg-muted/60 pr-1 text-xs font-medium transition-all',
              tab.isActive
                ? 'border-b-transparent bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
            )}
          >
            <button
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={cn(
                'flex-1 truncate px-3 py-2 text-left',
                tab.isActive ? 'text-foreground' : 'text-muted-foreground'
              )}
              aria-pressed={tab.isActive}
              aria-selected={tab.isActive}
            >
              <span className="block truncate" title={tab.label}>
                {tab.label}
              </span>
              {tab.isActive && <span className="sr-only"> (active)</span>}
            </button>
            <button
              type="button"
              onClick={() => onTabClose(tab.id)}
              className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground/70 transition hover:bg-muted-foreground/10 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Remove ${tab.label} from selection`}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        <div className="flex-1 border-b border-transparent" aria-hidden />
      </div>
    </div>
  );
};
