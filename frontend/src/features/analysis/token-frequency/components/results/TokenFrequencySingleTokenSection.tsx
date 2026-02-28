import type { NodeResultView } from '../../tokenFrequencyAdapters';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { Wordcloud } from '@visx/wordcloud';
import { Text } from '@visx/text';

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
        const nodeKey = result.nodeId || result.displayName || `node-${index}`;
        const color = getColorForNode(result.nodeId || result.displayName, index);
        const displayRows = Array.isArray(result.displayRows) ? result.displayRows.slice(0, MAX_ROWS) : [];
        const maxFrequency = Math.max(1, ...displayRows.map((row) => Number(row.frequency) || 0));
        const words = displayRows.map((item) => ({
          text: String(item?.token ?? ''),
          value: Number(item?.frequency) || 0,
        }));
        const fontSizeSetter = (datum: { value: number }) =>
          Math.max(12, Math.min(48, (datum.value / maxFrequency) * 36 + 12));

        return (
          <Card key={`${result.nodeId || result.displayName}-${index}`} className="h-full">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base font-semibold">{result.displayName}</CardTitle>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => onDownloadWordCloud(nodeKey, result.displayName)}>
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
              <div className="mb-4 flex w-full justify-center overflow-visible">
                <svg
                  ref={(element) => registerWordCloudRef(nodeKey, element)}
                  width={400}
                  height={200}
                  className="overflow-visible"
                  style={{ overflow: 'visible' }}
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <Wordcloud
                    words={words}
                    width={400}
                    height={200}
                    fontSize={fontSizeSetter}
                    font="Segoe UI, Roboto, sans-serif"
                    padding={2}
                    spiral="archimedean"
                    rotate={0}
                    random={() => 0.5}
                  >
                    {(cloudWords) =>
                      cloudWords.map((word) => (
                        <Text
                          key={word.text}
                          fill={color}
                          textAnchor="middle"
                          transform={`translate(${word.x}, ${word.y}) rotate(${word.rotate})`}
                          fontSize={word.size}
                          fontFamily={word.font}
                          className="cursor-pointer transition-colors"
                          onClick={() => word.text && onTokenClick(word.text)}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            if (word.text) {
                              onTokenRightClick(word.text, event);
                            }
                          }}
                          style={{ cursor: 'pointer' }}
                        >
                          {word.text || ''}
                        </Text>
                      ))
                    }
                  </Wordcloud>
                </svg>
              </div>

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
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};
