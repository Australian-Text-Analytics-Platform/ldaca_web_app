import { Camera, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useSnapshotViewStore } from '@/features/snapshot-view';

/**
 * Rendered by: QuotationFeature. Snapshot mode banner for quotation. Mirrors the concordance banner — because the analysis route needs this component to assemble the selected tab state, controls, task lifecycle, and results surface.
 * see ConcordanceSnapshotBanner for the design rationale.
 * Flow: normalize incoming props, derive display state, connect event handlers, then render the shared analysis UI.
 */
export function QuotationSnapshotBanner() {
  const snapshot = useSnapshotViewStore((s) => s.snapshots.quotation);
  const exitSnapshot = useSnapshotViewStore((s) => s.exitSnapshot);

  if (!snapshot) return null;

  const { manifest } = snapshot;
  const capturedAt = (() => {
    try {
      const d = new Date(manifest.captured_at);
      return Number.isNaN(d.getTime())
        ? manifest.captured_at
        : d.toLocaleString();
    } catch {
      return manifest.captured_at;
    }
  })();

  return (
    <Card className="border-amber-500/60 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-950/40 mb-4">
      <CardContent className="flex items-center gap-3 py-3">
        <Camera className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">
            Viewing snapshot: {manifest.title}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            Captured {capturedAt} · {manifest.tool_version}
            {manifest.source.workspace_name && ` · workspace ${manifest.source.workspace_name}`}
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => exitSnapshot('quotation')}
          aria-label="Exit snapshot view"
        >
          <LogOut className="mr-1.5 h-4 w-4" />
          Exit snapshot view
        </Button>
      </CardContent>
    </Card>
  );
}