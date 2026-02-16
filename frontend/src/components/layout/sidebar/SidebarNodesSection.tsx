import React from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { Copy, Check } from 'lucide-react';
import type { SidebarWorkspaceNode } from './types';

type CopiedField = { nodeId: string; field: 'name' | 'id' } | null;

type SidebarNodesSectionProps = {
  nodes: SidebarWorkspaceNode[];
  selectedNodeIds?: string[];
  onToggleNodeSelection: (nodeId: string) => void;
};

const SidebarNodesSection: React.FC<SidebarNodesSectionProps> = ({
  nodes,
  selectedNodeIds,
  onToggleNodeSelection,
}) => {
  const [copiedField, setCopiedField] = React.useState<CopiedField>(null);
  const copyTimeoutRef = React.useRef<number | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = React.useState<string | null>(null);

  const handleCopy = async (value: string | undefined | null, nodeId: string, field: 'name' | 'id') => {
    if (!value || typeof value !== 'string') return;
    if (typeof window === 'undefined') return;

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else if (typeof document !== 'undefined') {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }

      setCopiedField({ nodeId, field });
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => {
        setCopiedField(null);
      }, 1600);
    } catch (error) {
      console.error('SidebarNodesSection: failed to copy value', error);
    }
  };

  React.useEffect(() => () => {
    if (copyTimeoutRef.current) {
      window.clearTimeout(copyTimeoutRef.current);
    }
  }, []);

  const formatShapeLabel = (node: SidebarWorkspaceNode): string => {
    const rawShape = node.data?.shape || (node as { shape?: [number | null, number | null] }).shape;
    if (!rawShape) {
      return '—';
    }
    const [rows, cols] = rawShape;
    const formatPart = (value: number | null | undefined) =>
      typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '?';
    return `${formatPart(rows)} × ${formatPart(cols)}`;
  };

  const nodeCount = nodes.length;
  const selectedCount = selectedNodeIds?.length ?? 0;

  return (
    <div className="flex flex-col gap-2" onMouseLeave={() => setHoveredNodeId(null)}>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Total: {nodeCount}</span>
        <span>Selected: {selectedCount}</span>
      </div>
      <div className="space-y-2 pr-1">
        {nodes.length ? (
          nodes.map((node) => {
            const name = node?.data?.nodeName || node?.data?.label || node?.label || '';
            const shape = formatShapeLabel(node);
            const checked = selectedNodeIds?.includes(node.id);
            const copyNameValue = name && name.length > 0 ? name : node.id;
            const displayName = copyNameValue || 'Untitled data table';
            const isNameCopied = copiedField?.nodeId === node.id && copiedField.field === 'name';
            const isIdCopied = copiedField?.nodeId === node.id && copiedField.field === 'id';
            const isExpanded = hoveredNodeId === node.id;

            return (
              <div
                key={node.id}
                className={cn(
                  'group relative overflow-hidden rounded-md border border-transparent bg-background/40 px-2 py-2 text-sm transition-all duration-200 ease-out focus-within:border-border/60 focus-within:bg-accent/60',
                  checked
                    ? 'border-primary/60 bg-primary/10'
                    : 'hover:border-border/60 hover:bg-accent/60',
                  isExpanded && !checked && 'border-border/60 bg-accent/60 shadow-sm'
                )}
                onMouseEnter={() => setHoveredNodeId(node.id)}
                onMouseLeave={() => setHoveredNodeId((prev) => (prev === node.id ? null : prev))}
                onFocusCapture={() => setHoveredNodeId(node.id)}
                onBlurCapture={(event) => {
                  const related = event.relatedTarget as Node | null;
                  if (!related || !event.currentTarget.contains(related)) {
                    setHoveredNodeId((prev) => (prev === node.id ? null : prev));
                  }
                }}
              >
                <div className="flex items-center gap-3">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => onToggleNodeSelection(node.id)}
                    className="h-5 w-5 shrink-0 rounded-full border-border/70 text-primary-foreground data-[state=checked]:border-primary data-[state=checked]:bg-primary"
                    aria-label={`Select ${displayName}`}
                  />
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleCopy(copyNameValue, node.id, 'name');
                    }}
                    className="flex flex-1 min-w-0 items-center gap-2 bg-transparent text-left text-sm font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    title={displayName}
                  >
                    <span className="flex-1 min-w-0 truncate">{displayName}</span>
                    <span
                      className={cn(
                        'flex items-center shrink-0 text-xs text-muted-foreground transition-opacity duration-200 ease-out',
                        hoveredNodeId === node.id ? 'opacity-100' : 'opacity-0'
                      )}
                    >
                      {isNameCopied ? (
                        <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                    </span>
                  </button>
                </div>
                <div
                  className={cn(
                    'ml-7 mt-0 flex max-h-0 flex-wrap items-center gap-x-4 gap-y-1 overflow-hidden text-xs text-muted-foreground opacity-0 transition-all duration-200 ease-out',
                    isExpanded && 'mt-2 max-h-40 opacity-100'
                  )}
                >
                  <span className="flex items-center gap-1">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground/80">Shape</span>
                    <span className="font-medium text-foreground">{shape}</span>
                  </span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleCopy(node.id, node.id, 'id');
                    }}
                    className="flex min-w-0 max-w-full items-center gap-1 text-left text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    title="Copy data table ID"
                  >
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground/80 shrink-0">ID</span>
                    <span className="truncate font-mono text-[11px] text-foreground">{node.id}</span>
                    {isIdCopied ? (
                      <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <div className="rounded-md bg-accent/40 px-2 py-2 text-xs text-muted-foreground">No data tables</div>
        )}
      </div>
    </div>
  );
};

export default SidebarNodesSection;
