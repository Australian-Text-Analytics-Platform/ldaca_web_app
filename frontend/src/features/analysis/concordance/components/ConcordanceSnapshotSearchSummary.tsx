import React from 'react';
import { Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { SnapshotManifest } from '@/features/snapshot-view';

interface ConcordanceSnapshotSearchSummaryProps {
  manifest: SnapshotManifest;
}

/**
 * Read-only card rendered above the per-node result tabs in
 * snapshot mode. Pulls the searched term + total hits from the
 * manifest's preview block — that's the data the live parameter
 * panel would have otherwise shown the user.
 *
 * The full search-settings round-trip (regex on/off, context
 * widths, etc.) lands as a Phase-2 polish item once the capture
 * hook is reworked to persist the full ``ConcordanceRequest`` to
 * ``settings.json`` (today it persists ``results.metadata`` by
 * mistake — bug noted, scheduled for fix alongside Phase 1b-2's
 * post-test cleanup).
 */
export const ConcordanceSnapshotSearchSummary: React.FC<
  ConcordanceSnapshotSearchSummaryProps
> = ({ manifest }) => {
  if (manifest.preview.tool !== 'concordance') return null;
  const { searchTerm, totalHits, materialised } = manifest.preview;

  return (
    <Card>
      <CardHeader className="space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Search className="h-4 w-4" />
          Captured search
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Search term:</span>
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
            {searchTerm || '(unknown)'}
          </code>
          <Badge variant="secondary" className="text-xs font-normal">
            {totalHits.toLocaleString()} hit{totalHits === 1 ? '' : 's'}
          </Badge>
          {materialised && (
            <Badge variant="outline" className="text-xs font-normal">
              Materialised
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
