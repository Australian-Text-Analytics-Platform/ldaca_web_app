import { useState, useEffect, useRef } from 'react';
import { NodeProps, Handle, Position, useStore } from '@xyflow/react';
import { Settings2, Trash2, Copy, Check } from 'lucide-react';
import { WorkspaceNode } from '../types';

type DebugWindow = Window & { __LDACA_DEBUG_GRAPH?: boolean };

interface CustomNodeData {
  node: WorkspaceNode;
  isMultiSelected?: boolean;
  onDelete: (nodeId: string) => void;
  onRename?: (nodeId: string, newName: string) => void;
  onCopy?: (nodeId: string) => void;
}

function CustomNode({ data, selected }: NodeProps<any>) {
  const { node: initialNode, isMultiSelected = false, onDelete, onRename, onCopy } = data as CustomNodeData;
  // Keep a local state but always sync with props to prevent staleness after in-place updates
  const [node, setNode] = useState(initialNode);
  const [showMenu, setShowMenu] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const zoom = useStore((s) => s.transform[2]);
  const isZoomedOut = zoom < 0.7;

  const debugWindow: DebugWindow | null = typeof window !== 'undefined' ? (window as DebugWindow) : null;
  const DEBUG_GRAPH = Boolean(debugWindow?.__LDACA_DEBUG_GRAPH) || (typeof window !== 'undefined' && localStorage.getItem('debugGraph') === '1');
  const dlog = (...args: unknown[]) => {
    if (DEBUG_GRAPH) console.debug(...args);
  };

  useEffect(() => {
    dlog('CustomNode: node updated', {
      nodeId: initialNode?.node_id,
      dataType: initialNode?.data_type,
      nodeName: initialNode?.name,
      isRendering: true
    });
    setNode(initialNode);
  }, [initialNode, dlog]);

  const nodeName = node?.name || 'Loading...';
  const nodeShape = node?.shape;

  // Close menu when clicking outside (capture to beat React Flow internal handlers)
  useEffect(() => {
    if (!showMenu) return;
    const handlePointerDown = (event: Event) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown, { capture: true });
    return () => document.removeEventListener('pointerdown', handlePointerDown, { capture: true });
  }, [showMenu]);

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node?.node_id) {
      onDelete(node.node_id);
    }
  };

  const handleSaveClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    // TODO: Implement save functionality
    console.debug('Save node data:', node.node_id);
  };

  const handleRenameClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    setNewName(node?.name || '');
    setIsRenaming(true);
    setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 10);
  };

  const handleRenameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onRename && node?.node_id && newName.trim()) {
      onRename(node.node_id, newName.trim());
    }
    setIsRenaming(false);
    setNewName('');
  };

  const handleRenameCancel = () => {
    setIsRenaming(false);
    setNewName('');
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleRenameCancel();
    }
  };

  const handleCopyNode = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    if (onCopy && node?.node_id) {
      onCopy(node.node_id);
    }
  };

  const handleCopyId = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node?.node_id) {
      navigator.clipboard.writeText(node.node_id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Unified highlight style: apply the multi-select (green) style for any selection (single or multi)
  const isHighlighted = selected || isMultiSelected;
  const nodeClasses = `
    w-64 rounded-lg border-2 bg-white text-sm transition-all duration-150 ease-in-out
    ${isHighlighted
      ? 'border-green-500 bg-green-50 shadow-lg ring-2 ring-green-200'
      : 'border-border shadow-md'}
  `;

  const formatShapePart = (value: number | null | undefined) =>
    typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '?';

  const shapeLabel = nodeShape
    ? `${formatShapePart(nodeShape[0])} × ${formatShapePart(nodeShape[1])}`
    : null;

  dlog('CustomNode rendering:', {
    nodeId: node?.node_id,
    nodeName,
    selected,
    isMultiSelected,
    shape: nodeShape,
    shapeFirstElement: nodeShape ? nodeShape[0] : 'no shape',
    isFirstElementNull: nodeShape ? nodeShape[0] === null : 'no shape'
  });

  if (isZoomedOut) {
    // Compact view: name only, single uniform box
    const compactClasses = `
      flex items-start rounded-lg border-2 p-4 transition-all duration-150 ease-in-out
      ${isHighlighted
        ? 'border-green-500 bg-green-100 shadow-lg ring-2 ring-green-200'
        : 'border-border bg-muted shadow-md'}
    `;
    return (
      <div
        className={compactClasses}
        style={{ minWidth: '180px', maxWidth: '300px', position: 'relative' }}
      >
        {isHighlighted && (
          <div className="w-3 h-3 bg-green-500 rounded-full mr-2.5 mt-2 shrink-0" />
        )}
        <div
          className="font-bold text-3xl leading-snug whitespace-normal"
          style={{ wordBreak: 'break-word', overflowWrap: 'anywhere', hyphens: 'auto' }}
          title={nodeName}
        >
          {nodeName}
        </div>
        <Handle type="target" position={Position.Left} className="w-2! h-2! bg-gray-400! opacity-0 pointer-events-none" />
        <Handle type="source" position={Position.Right} className="w-2! h-2! bg-gray-400! opacity-0 pointer-events-none" />
      </div>
    );
  }

  return (
    <div className={nodeClasses} style={{ minWidth: '256px', minHeight: '120px', position: 'relative' }}>
      {/* Node Header */}
      <div className={`flex items-start justify-between p-2 rounded-t-lg border-b-2 min-h-fit relative ${
        isHighlighted ? 'bg-green-100 border-green-300' : 'bg-muted border-border'
      }`}>
        <div className="flex items-center flex-1 mr-2">
          {isHighlighted && (
            <div
              className="w-2 h-2 bg-green-500 rounded-full mr-2 flex-shrink-0"
              title={isMultiSelected ? 'Selected for joining' : 'Selected'}
            ></div>
          )}
          {isRenaming ? (
            <form onSubmit={handleRenameSubmit} className="flex-1 relative z-50">
              <input
                ref={renameInputRef}
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onBlur={handleRenameCancel}
                onKeyDown={handleRenameKeyDown}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                className="w-full text-sm font-bold bg-white border border-blue-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500 relative z-50"
                style={{ 
                  fontSize: '14px',
                  lineHeight: '1.2'
                }}
              />
            </form>
          ) : (
            <div 
              className="font-bold text-sm leading-tight overflow-hidden"
              style={{ 
                wordBreak: 'break-all',
                overflowWrap: 'anywhere',
                hyphens: 'auto'
              }}
              title={nodeName}
            >
              {nodeName}
            </div>
          )}
        </div>
        
        <div className="flex items-center space-x-1 flex-shrink-0">
          {/* More menu button */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(!showMenu);
              }}
              className="w-5 h-5 flex items-center justify-center text-gray-500 hover:text-gray-700 rounded transition-colors"
              title="More options"
              aria-label="Node settings"
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>
            
            {/* Dropdown menu */}
            {showMenu && (
              <div className="absolute right-0 top-6 bg-white border border-border rounded-md shadow-lg z-10 min-w-36">
                <button
                  onClick={handleSaveClick}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-muted/60 rounded-md"
                >
                  Save
                </button>
                
                <button
                  onClick={handleRenameClick}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-muted/60 border-t border-border/60"
                >
                  Rename
                </button>

                <button
                  onClick={handleCopyNode}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-muted/60 border-t border-border/60"
                >
                  Copy
                </button>
                
              </div>
            )}
          </div>
          
          {/* Delete button */}
          <button
            onClick={handleDeleteClick}
            className="w-5 h-5 flex items-center justify-center text-red-500 hover:text-red-700 rounded transition-colors"
            title="Delete node"
            aria-label="Delete node"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Node Body */}
      <div className="p-3 bg-white rounded-b-lg space-y-1">
        <div className="flex items-center justify-between group">
          <div className="font-mono text-xs text-gray-500 truncate max-w-[180px]" title={node?.node_id}>
            id: {node?.node_id?.substring(0, 8)}...
          </div>
          <button
            onClick={handleCopyId}
            className="p-1 hover:bg-gray-100 rounded transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
            title="Copy ID"
          >
            {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3 text-gray-400" />}
          </button>
        </div>
        {shapeLabel ? (
          <div className="font-mono text-xs text-gray-700">Shape: {shapeLabel}</div>
        ) : (
          <div className="font-mono text-xs text-gray-400 italic">Shape unavailable</div>
        )}
      </div>

      {/* Passive handles so backend edges can attach; UI connections remain disabled by parent ReactFlow props */}
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-gray-400 opacity-0 pointer-events-none" />
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-gray-400 opacity-0 pointer-events-none" />

    </div>
  );
};

export default CustomNode;
