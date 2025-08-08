import React, { memo, useState, useEffect, useRef, useCallback } from 'react';
import { NodeProps, Handle, Position } from '@xyflow/react';
import { WorkspaceNode } from '../types';
import DocumentColumnModal from './DocumentColumnModal';
import { formatDataType, getTypeStyleClass } from '../utils/typeFormatting';
import { useWorkspace } from '../hooks/useWorkspace';

interface CustomNodeData {
  node: WorkspaceNode;
  isMultiSelected?: boolean;
  onDelete: (nodeId: string) => void;
  onRename?: (nodeId: string, newName: string) => void;
  onConvertToDocDataFrame?: (nodeId: string, documentColumn: string) => void;
  onConvertToDataFrame?: (nodeId: string) => void;
  onConvertToDocLazyFrame?: (nodeId: string, documentColumn: string) => void;
  onConvertToLazyFrame?: (nodeId: string) => void;
}

const CustomNode: React.FC<NodeProps<any>> = ({ data, selected }) => {
  const { node: initialNode, isMultiSelected = false, onDelete, onRename, onConvertToDocDataFrame, onConvertToDataFrame, onConvertToDocLazyFrame, onConvertToLazyFrame } = data as CustomNodeData;
  // Keep a local state but always sync with props to prevent staleness after in-place updates
  const [node, setNode] = useState(initialNode);
  const [showMenu, setShowMenu] = useState(false);
  const [showDocColumnModal, setShowDocColumnModal] = useState(false);
  const [docConversionTarget, setDocConversionTarget] = useState<'docdataframe' | 'doclazyframe' | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [isHoveringShape, setIsHoveringShape] = useState(false);
  const [hoveredShape, setHoveredShape] = useState<[number, number] | null>(null);
  const [isLoadingHoverShape, setIsLoadingHoverShape] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const { getNodeShape } = useWorkspace();

  useEffect(() => {
    console.log('CustomNode: node updated', {
      nodeId: initialNode?.node_id,
      dataType: initialNode?.data_type,
      nodeName: initialNode?.name,
      isRendering: true
    });
    setNode(initialNode);
  }, [initialNode]);

  const nodeName = node?.name || 'Loading...';
  const nodeShape = node?.shape;
  const nodeDataType = node?.data_type || initialNode?.data_type || 'unknown';
  const nodeColumns = node?.columns || [];

  // Format the data type for better display
  const formattedType = formatDataType(nodeDataType);

  // Determine if conversion options should be shown - updated for complete module.class format
  const isPolarsDataFrameOrLazy = formattedType.category === 'polars' && (formattedType.full.includes('DataFrame') || formattedType.full.includes('LazyFrame'));
  const isDocDataFrameOrLazy = formattedType.category === 'docframe' && (formattedType.full.includes('DocDataFrame') || formattedType.full.includes('DocLazyFrame'));

  // Handle shape hover for lazy frames with null first element
  const handleShapeMouseEnter = useCallback(async () => {
    if (nodeShape && nodeShape[0] === null && getNodeShape && node?.node_id) {
      setIsHoveringShape(true);
      setIsLoadingHoverShape(true);
      
      try {
        const shapeData = await getNodeShape(node.node_id);
        if (shapeData && shapeData.shape) {
          setHoveredShape(shapeData.shape as [number, number]);
        }
      } catch (error) {
        console.error('Failed to fetch shape on hover:', error);
      } finally {
        setIsLoadingHoverShape(false);
      }
    }
  }, [nodeShape, getNodeShape, node?.node_id]);

  const handleShapeMouseLeave = useCallback(() => {
    setIsHoveringShape(false);
    setHoveredShape(null);
    setIsLoadingHoverShape(false);
  }, []);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };

    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
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
    console.log('Save node data:', node.node_id);
  };

  const handleToDocDataFrameClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    setDocConversionTarget('docdataframe');
    setShowDocColumnModal(true);
  };

  const handleToDataFrameClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    if (onConvertToDataFrame && node?.node_id) {
      onConvertToDataFrame(node.node_id);
    }
  };

  const handleToDocLazyFrameClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    setDocConversionTarget('doclazyframe');
    setShowDocColumnModal(true);
  };

  const handleToLazyFrameClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    if (onConvertToLazyFrame && node?.node_id) {
      onConvertToLazyFrame(node.node_id);
    }
  };

  const handleRenameClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    setNewName(node?.name || '');
    setIsRenaming(true);
    // Focus the input after a brief delay to ensure it's rendered
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

  const handleDocColumnConfirm = (documentColumn: string) => {
    if (!node?.node_id) return;
    if (docConversionTarget === 'docdataframe' && onConvertToDocDataFrame) {
      onConvertToDocDataFrame(node.node_id, documentColumn);
    } else if (docConversionTarget === 'doclazyframe' && onConvertToDocLazyFrame) {
      onConvertToDocLazyFrame(node.node_id, documentColumn);
    }
  setShowDocColumnModal(false);
  setDocConversionTarget(null);
  };

  const nodeClasses = `
    w-64 rounded-lg border-2 bg-white text-sm transition-all duration-150 ease-in-out
    ${isMultiSelected 
      ? 'border-green-500 bg-green-50 shadow-lg ring-2 ring-green-200' 
      : selected 
        ? 'border-blue-500 shadow-lg' 
        : 'border-gray-400 shadow-md'
    }
  `;

  console.log('CustomNode rendering:', {
    nodeId: node?.node_id,
    nodeName,
    selected,
    isMultiSelected,
    shape: nodeShape,
    shapeFirstElement: nodeShape ? nodeShape[0] : 'no shape',
    isFirstElementNull: nodeShape ? nodeShape[0] === null : 'no shape'
  });

  return (
    <div className={nodeClasses} style={{ minWidth: '256px', minHeight: '120px', position: 'relative' }}>
      {/* Node Header */}
      <div className={`flex items-start justify-between p-2 rounded-t-lg border-b-2 min-h-fit relative ${
        isMultiSelected ? 'bg-green-100 border-green-300' : 'bg-gray-100 border-gray-200'
      }`}>
        <div className="flex items-center flex-1 mr-2">
          {isMultiSelected && (
            <div className="w-2 h-2 bg-green-500 rounded-full mr-2 flex-shrink-0" title="Selected for joining"></div>
          )}
          {isRenaming ? (
            <form onSubmit={handleRenameSubmit} className="flex-1">
              <input
                ref={renameInputRef}
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onBlur={handleRenameCancel}
                onKeyDown={handleRenameKeyDown}
                className="w-full text-sm font-bold bg-white border border-blue-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
            >
              ⋯
            </button>
            
            {/* Dropdown menu */}
            {showMenu && (
              <div className="absolute right-0 top-6 bg-white border border-gray-200 rounded-md shadow-lg z-10 min-w-36">
                <button
                  onClick={handleSaveClick}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-gray-100 rounded-md"
                >
                  Save
                </button>
                
                <button
                  onClick={handleRenameClick}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-gray-100 border-t border-gray-100"
                >
                  Rename
                </button>
                
                {/* Show conversion options for polars DataFrames/LazyFrames */}
                {isPolarsDataFrameOrLazy && (
                  <>
                    <button
                      onClick={handleToDocDataFrameClick}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-gray-100 border-t border-gray-100"
                    >
                      to DocDataFrame
                    </button>
                    <button
                      onClick={handleToDocLazyFrameClick}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-gray-100 border-t border-gray-100"
                    >
                      to DocLazyFrame
                    </button>
                  </>
                )}
                
                {/* Show conversion options for DocDataFrame/DocLazyFrame */}
                {isDocDataFrameOrLazy && (
                  <>
                    <button
                      onClick={handleToDataFrameClick}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-gray-100 border-t border-gray-100"
                    >
                      to DataFrame
                    </button>
                    <button
                      onClick={handleToLazyFrameClick}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-gray-100 border-t border-gray-100"
                    >
                      to LazyFrame
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          
          {/* Delete button */}
          <button
            onClick={handleDeleteClick}
            className="w-5 h-5 flex items-center justify-center text-red-500 hover:text-red-700 rounded transition-colors"
            title="Delete node"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Node Body */}
      <div className="p-3 bg-white rounded-b-lg">
        <div 
          className={`font-mono text-xs px-2 py-1 rounded ${getTypeStyleClass(formattedType.category)} cursor-help`}
          title={`Full type: ${formattedType.full}`}
        >
          {formattedType.display}
          {node?.is_lazy && (
            <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
              lazy
            </span>
          )}
        </div>
        {nodeShape ? (
          <div 
            className="font-mono text-xs text-gray-600 mt-1 relative"
            onMouseEnter={nodeShape[0] === null ? handleShapeMouseEnter : undefined}
            onMouseLeave={nodeShape[0] === null ? handleShapeMouseLeave : undefined}
          >
            Shape: ({(() => {
              if (nodeShape[0] === null) {
                if (isHoveringShape) {
                  if (isLoadingHoverShape) {
                    return '...';
                  } else if (hoveredShape) {
                    return hoveredShape[0];
                  }
                }
                return '?';
              }
              return nodeShape[0];
            })()} × {nodeShape[1]})
            
            {/* Tooltip removed per UX request; inline value update remains */}
          </div>
        ) : (
          <div className="font-mono text-xs text-gray-400 italic mt-1">No data preview</div>
        )}
      </div>

  {/* Passive handles so backend edges can attach; UI connections remain disabled by parent ReactFlow props */}
  <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-gray-400 opacity-0 pointer-events-none" />
  <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-gray-400 opacity-0 pointer-events-none" />

      {/* Modal for selecting document column */}
      <DocumentColumnModal
        isOpen={showDocColumnModal}
  onClose={() => { setShowDocColumnModal(false); setDocConversionTarget(null); }}
        onConfirm={handleDocColumnConfirm}
        columns={nodeColumns}
        nodeName={nodeName}
      />
    </div>
  );
};

export default memo(CustomNode);
