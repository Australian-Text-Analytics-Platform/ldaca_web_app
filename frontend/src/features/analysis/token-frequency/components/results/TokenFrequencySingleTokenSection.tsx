import type { NodeResultView } from '../../tokenFrequencyAdapters';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';

type TokenFrequencySingleTokenSectionProps = {
  nodeDisplayResults: NodeResultView[];
  getColorForNode: (nodeId: string, index?: number) => string;
  onTokenClick: (token: string) => void;
  onTokenRightClick: (token: string, event?: React.MouseEvent) => void;
  onDownloadWordCloud: (nodeKey: string, displayName: string) => void;
  onDownloadFrequencyCsv: (label: string, rows: any[]) => void;
  registerWordCloudRef: (nodeKey: string, element: SVGSVGElement | null) => void;
};

const MAX_ROWS = 30;

export const TokenFrequencySingleTokenSection = ({
  nodeDisplayResults,
  getColorForNode,
  onTokenClick,
  onTokenRightClick,
  onDownloadWordCloud,
  onDownloadFrequencyCsv,
  registerWordCloudRef,
}: TokenFrequencySingleTokenSectionProps) => {
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      {nodeDisplayResults.map((result, index) => {
        const color = getColorForNode(result.nodeId || result.displayName, index);
        const displayRows = Array.isArray(result.displayRows) ? result.displayRows.slice(0, MAX_ROWS) : [];
        const maxFrequency = Math.max(1, ...displayRows.map((row) => Number(row.frequency) || 0));

        return (
          <Card key={`${result.nodeId || result.displayName}-${index}`} className="h-full">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base font-semibold">{result.displayName}</CardTitle>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => onDownloadWordCloud(result.nodeId, result.displayName)}>
                    <Download className="mr-2 h-4 w-4" />
                    Cloud
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onDownloadFrequencyCsv(result.displayName, Array.isArray(result.filteredRows) ? result.filteredRows : result.rows)}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    CSV
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-2">
              <div className="space-y-2">
                {displayRows.map((row) => {
                  const frequency = Number(row.frequency) || 0;
                  const widthPct = Math.max(3, Math.round((frequency / maxFrequency) * 100));
                  return (
                    <div key={`${result.nodeId}-${row.token}`} className="grid grid-cols-[minmax(0,1fr)_90px] items-center gap-2">
                      <button
                        type="button"
                        className="group relative h-8 overflow-hidden rounded border text-left"
                        onClick={() => onTokenClick(row.token)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          onTokenRightClick(row.token, event);
                        }}
                        title="Click to inspect in concordance. Right-click to add to stop words."
                      >
                        <span
                          className="absolute inset-y-0 left-0 rounded bg-primary/20 group-hover:bg-primary/30"
                          style={{ width: `${widthPct}%`, backgroundColor: color }}
                        />
                        <span className="relative z-10 block truncate px-2 text-sm font-medium">{row.token}</span>
                      </button>
                      <span className="text-right text-xs tabular-nums text-muted-foreground">{frequency}</span>
                    </div>
                  );
                })}
              </div>

              <div className="h-0 w-0 overflow-hidden">
                <svg
                  ref={(element) => registerWordCloudRef(result.nodeId, element)}
                  xmlns="http://www.w3.org/2000/svg"
                  width="1"
                  height="1"
                  viewBox="0 0 1 1"
                />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};
