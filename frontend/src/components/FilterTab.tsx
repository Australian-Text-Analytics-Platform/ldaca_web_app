import React, { useState, useEffect, useMemo } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { useWorkspace } from '../hooks/useWorkspace';
import { FilterCondition, FilterRequest } from '../api';

// (Removed unused DATA_TYPES constant to satisfy lint)

// Utility function to normalize type names
const normalizeTypeName = (type: string): string => {
  const lowercaseType = type.toLowerCase();
  if (lowercaseType.includes('utf8') || lowercaseType.includes('string')) return 'string';
  if (lowercaseType.includes('int') && !lowercaseType.includes('interval')) return 'integer';
  if (lowercaseType.includes('float') || lowercaseType.includes('double')) return 'float';
  if (lowercaseType.includes('bool')) return 'boolean';
  if (lowercaseType.includes('datetime') || lowercaseType.includes('timestamp')) return 'datetime';
  if (lowercaseType.includes('list') || lowercaseType.includes('array')) return 'array';
  return 'string'; // Default fallback
};

// Get operators for each data type (simplified, lowercase labels)
// Removed: not equal, is not null, greater than, less than
// Kept: equals, contains/startswith/endswith (strings), is null, gte, lte, between
const getOperatorsForType = (dataType: string) => {
  switch (dataType) {
    case 'string':
      return [
  { value: 'eq', label: 'equals' },
  { value: 'contains', label: 'contains' },
  { value: 'startswith', label: 'starts with' },
  { value: 'endswith', label: 'ends with' },
  { value: 'is_null', label: 'is null' },
      ];
    case 'integer':
    case 'float':
      return [
  { value: 'eq', label: 'equals' },
  { value: 'gte', label: 'greater than or equal' },
  { value: 'lte', label: 'less than or equal' },
  { value: 'is_null', label: 'is null' },
      ];
    case 'boolean':
      return [
  { value: 'eq', label: 'equals' },
  { value: 'is_null', label: 'is null' },
      ];
    case 'datetime':
      return [
  { value: 'eq', label: 'equals' },
  { value: 'gte', label: 'after or equal' },
  { value: 'lte', label: 'before or equal' },
  { value: 'between', label: 'between' },
  { value: 'is_null', label: 'is null' },
      ];
    default:
      return [
  { value: 'eq', label: 'equals' },
  { value: 'is_null', label: 'is null' },
      ];
  }
};

// Extended interface for UI with tracking ID
interface FilterConditionWithId extends Omit<FilterCondition, 'value'> {
  id: string;
  dataType?: string;
  value: string | number | boolean | Date | { start: Date | null, end: Date | null } | null;
  negate?: boolean;
  regex?: boolean;
}

// Removed DatePicker & custom time input: now using direct ISO8601 text input for timezone-aware datetime entry.

const FilterTab: React.FC = () => {
  const { 
    selectedNodeId, 
    selectedNode,
    nodeData,
    filterNode,
    isLoading
  } = useWorkspace();

  const [conditions, setConditions] = useState<FilterConditionWithId[]>([{
    id: '1',
    column: '',
    operator: 'eq',
    value: '',
    negate: false,
    regex: true,
  }]);
  const [logic, setLogic] = useState<'and' | 'or'>('and');
  const [newNodeName, setNewNodeName] = useState('');
  const [isFiltering, setIsFiltering] = useState(false);

  // Get available columns with their datatypes from node data
  const availableColumns = useMemo(() => {
    const columns: Array<{name: string, dataType: string}> = [];
    
    // First try to get columns from nodeData (which includes actual column names)
    if (nodeData?.columns && Array.isArray(nodeData.columns) && nodeData?.dtypes) {
      nodeData.columns.forEach((colName: string) => {
        const rawDataType = nodeData.dtypes[colName] || 'unknown';
        const normalizedDataType = normalizeTypeName(rawDataType);
        columns.push({ name: colName, dataType: normalizedDataType });
      });
    }
    // Fallback to dtypes keys if available
    else if (nodeData?.dtypes && typeof nodeData.dtypes === 'object') {
      Object.keys(nodeData.dtypes).forEach(colName => {
        const rawDataType = nodeData.dtypes[colName] || 'unknown';
        const normalizedDataType = normalizeTypeName(rawDataType);
        columns.push({ name: colName, dataType: normalizedDataType });
      });
    }
    // Last fallback to schema if available
    else if (selectedNode?.data?.schema) {
      Object.keys(selectedNode.data.schema).forEach(colName => {
        // Schema doesn't have types, so default to string
        columns.push({ name: colName, dataType: 'string' });
      });
    }
    
    return columns;
  }, [nodeData?.columns, nodeData?.dtypes, selectedNode?.data?.schema]);

  // Auto-generate node name based on selected node
  useEffect(() => {
    if (selectedNode?.data?.name) {
      setNewNodeName(`${selectedNode.data.name}_filtered`);
    }
  }, [selectedNode]);

  const handleAddCondition = () => {
    const firstColumn = availableColumns[0];
    const newCondition: FilterConditionWithId = {
      id: Date.now().toString(),
      column: firstColumn ? firstColumn.name : '',
      operator: 'eq',
      value: '',
      dataType: firstColumn ? firstColumn.dataType : 'string',
      negate: false,
      regex: true,
    };
    setConditions([...conditions, newCondition]);
  };

  const handleRemoveCondition = (id: string) => {
    if (conditions.length > 1) {
      setConditions(conditions.filter(c => c.id !== id));
    }
  };

  const handleConditionChange = (id: string, field: keyof FilterConditionWithId, value: any) => {
    setConditions(conditions.map(c => {
      if (c.id === id) {
        const updated = { ...c, [field]: value };
        
        // If column changed, update dataType and reset operator
        if (field === 'column') {
          const columnInfo = availableColumns.find(col => col.name === value);
          if (columnInfo) {
            updated.dataType = columnInfo.dataType;
            updated.operator = 'eq'; // Reset to default operator
            updated.value = ''; // Reset value
          }
        }
        
        return updated;
      }
      return c;
    }));
  };

  // Render appropriate input based on data type and operator
  const renderValueInput = (condition: FilterConditionWithId) => {
    const dataType = condition.dataType || 'string';

    if (dataType === 'boolean') {
      return (
        <select
          value={String(condition.value)}
          onChange={(e) => handleConditionChange(condition.id, 'value', e.target.value === 'true')}
          className="px-2 py-1 border border-gray-300 rounded text-sm flex-1"
        >
          <option value="">Select value</option>
          <option value="true">True</option>
          <option value="false">False</option>
        </select>
      );
    }

    if (dataType === 'datetime') {
  const isoPlaceholder = 'YYYY-MM-DDTHH:MM:SS+00:00';
      const parseIso = (s: string): Date | null => {
        if (!s) return null;
        // Accept missing seconds (add :00Z if only minutes and no tz)
        let candidate = s.trim();
        // If user entered just date, append T00:00:00Z
    if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
      candidate += 'T00:00:00+00:00';
        }
        // Add seconds if missing (pattern HH:MM(+tz) or HH:MMZ)
        if (/T\d{2}:\d{2}(Z|[+-]\d{2}:?\d{2})?$/.test(candidate)) {
          candidate = candidate.replace(/T(\d{2}:\d{2})(Z|[+-]\d{2}:?\d{2})?$/, (m, hm, tz) => `T${hm}:00${tz || '+00:00'}`);
        }
        // If no timezone specified, assume Z
        if (/T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(candidate)) {
          candidate += '+00:00';
        }
        // Normalize timezone without colon
  candidate = candidate.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
        const d = new Date(candidate);
        if (isNaN(d.getTime())) return null;
        // We want DatePicker to show the same HH:MM as the ISO value (which is UTC).
        // Convert the UTC instant to a local wall date keeping the UTC components.
        try {
          const m = candidate.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
          if (m) {
            const [, Y, M, D, H, Min, S] = m;
            return new Date(Number(Y), Number(M) - 1, Number(D), Number(H), Number(Min), Number(S));
          }
        } catch { /* ignore */ }
        return d;
      };

      const buildPicker = (committedValue: string, commitValue: (v: string)=>void) => {
        const committedDate = parseIso(committedValue);
        // Buffered input component
        // eslint-disable-next-line react/display-name
        const IsoInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>((props, ref) => {
          const [draft, setDraft] = React.useState(committedValue);
          const [focused, setFocused] = React.useState(false);
          // Sync external committed value when not actively editing
          React.useEffect(() => {
            if (!focused) {
              setDraft(committedValue);
            }
          // eslint-disable-next-line react-hooks/exhaustive-deps
          }, [committedValue, focused]);

          const normalize = (txt: string): string => {
            let s = txt.trim();
            if (!s) return s;
            // If only date
            if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00+00:00';
            // If missing seconds but has HH:MM
            if (/T\d{2}:\d{2}(\+00:00)?$/.test(s)) s = s.replace(/T(\d{2}:\d{2})(\+00:00)?$/, (m,_hm,_tz) => `T${_hm}:00+00:00`);
            // Ensure timezone
            if (/T\d{2}:\d{2}:\d{2}$/.test(s)) s += '+00:00';
            // Canonicalize Z to +00:00
            s = s.replace(/Z$/, '+00:00');
            return s;
          };

            const commit = () => {
              const normalized = normalize(draft);
              commitValue(normalized || '');
              setDraft(normalized);
            };

          return (
            <input
              {...props}
              ref={ref}
              type="text"
              value={draft}
              onFocus={() => setFocused(true)}
              onBlur={() => { setFocused(false); commit(); }}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); } }}
              placeholder={isoPlaceholder}
              className="px-2 py-1 border border-gray-300 rounded text-sm font-mono"
              size={28}
              style={{ width: '28ch', minWidth: '28ch', maxWidth: '28ch', flex: 'none' }}
            />
          );
        });

        return (
          <DatePicker
            selected={committedDate || undefined}
            onChange={(d) => {
              if (d) {
                const pad = (n:number) => String(n).padStart(2,'0');
                const iso = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}+00:00`;
                commitValue(iso);
              }
            }}
            showTimeSelect
            timeIntervals={15}
            dateFormat="yyyy-MM-dd'T'HH:mm:ssXXX"
            customInput={<IsoInput />}
            popperClassName="z-50"
          />
        );
      };
      if (condition.operator === 'between') {
        const rangeValue = (condition.value as { start?: string | Date | null; end?: string | Date | null }) || {};
        const startStr =
          typeof rangeValue.start === 'string'
            ? rangeValue.start
            : rangeValue.start instanceof Date
              ? rangeValue.start.toISOString()
              : '';
        const endStr =
          typeof rangeValue.end === 'string'
            ? rangeValue.end
            : rangeValue.end instanceof Date
              ? rangeValue.end.toISOString()
              : '';
        return (
          <div className="flex items-center space-x-2">
            <div className="flex-none">{buildPicker(startStr, (v) => handleConditionChange(condition.id, 'value', { ...rangeValue, start: v }))}</div>
            <div className="flex-none">{buildPicker(endStr, (v) => handleConditionChange(condition.id, 'value', { ...rangeValue, end: v }))}</div>
          </div>
        );
      }
      const singleVal =
        typeof condition.value === 'string'
          ? condition.value
          : condition.value instanceof Date
            ? condition.value.toISOString()
            : '';
      return buildPicker(singleVal, (v) => handleConditionChange(condition.id, 'value', v));
    }

    if (dataType === 'integer' || dataType === 'float') {
      return (
        <input
          type="number"
          step={dataType === 'float' ? 'any' : '1'}
          value={String(condition.value)}
          onChange={(e) => handleConditionChange(condition.id, 'value', 
            dataType === 'integer' ? parseInt(e.target.value) || 0 : parseFloat(e.target.value) || 0)}
          placeholder="Enter number"
          className="px-2 py-1 border border-gray-300 rounded text-sm flex-1"
        />
      );
    }

    // Default: string input
    return (
      <input
        type="text"
        value={String(condition.value)}
        onChange={(e) => handleConditionChange(condition.id, 'value', e.target.value)}
        placeholder="Enter value"
        className="px-2 py-1 border border-gray-300 rounded text-sm flex-1"
      />
    );
  };

  const handleApplyFilter = async () => {
    if (!selectedNodeId) {
      alert('Please select a node first');
      return;
    }

  if (conditions.some(c => !c.column || (c.operator !== 'is_null' && !c.value))) {
      alert('Please fill in all filter conditions');
      return;
    }

    // Serialize conditions for API
    const serializedConditions = conditions.map(c => {
      let value: any;
  if (c.operator === 'is_null') {
        value = null;
      } else if (c.value instanceof Date) {
        value = c.value.toISOString();
      } else if (c.value && typeof c.value === 'object' && 'start' in c.value) {
        const range: any = c.value;
        value = {
          start: range.start instanceof Date ? range.start.toISOString() : (typeof range.start === 'string' ? range.start : null),
          end: range.end instanceof Date ? range.end.toISOString() : (typeof range.end === 'string' ? range.end : null)
        };
      } else {
        value = c.value;
      }
  const payload: any = { column: c.column, operator: c.operator, value };
  if ((c as any).negate !== undefined) payload.negate = Boolean((c as any).negate);
  if ((c as any).regex !== undefined) payload.regex = Boolean((c as any).regex);
  return payload;
    });

    const request: FilterRequest = {
      conditions: serializedConditions,
      logic,
      new_node_name: newNodeName || undefined
    };

    try {
      setIsFiltering(true);
      await filterNode(selectedNodeId, request);
      // Success - the graph should automatically refresh due to query invalidation
    } catch (error) {
      console.error('Filter error:', error);
      alert(`Error applying filter: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsFiltering(false);
    }
  };

  if (!selectedNodeId) {
    return (
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h3 className="text-lg font-medium text-blue-800 mb-2">Filter Data</h3>
        <p className="text-blue-700">
          Please select a node from the graph to apply filters.
        </p>
      </div>
    );
  }

  if (availableColumns.length === 0) {
    return (
      <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
        <h3 className="text-lg font-medium text-yellow-800 mb-2">Filter Data</h3>
        <p className="text-yellow-700">
          Loading node schema... Please wait.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-lg font-medium text-gray-900 mb-4">Filter Data</h3>
      
      {/* Selected Node Info */}
      <div className="bg-gray-50 p-4 rounded-lg space-y-2">
        <div>
          {(() => {
            const displayName = selectedNode ? (
              selectedNode.data?.nodeName || selectedNode.data?.label || selectedNode.data?.name || selectedNode.label || selectedNode.id || selectedNodeId
            ) : selectedNodeId;
            return (
              <>
                <div className="text-sm font-medium text-gray-800 break-words">{displayName}</div>
                <div className="text-xs text-gray-500 break-all">{selectedNodeId}</div>
              </>
            );
          })()}
        </div>
        <div className="pt-1">
          <div className="text-xs font-semibold text-gray-600 mb-1 tracking-wide">SCHEMA</div>
          <div className="overflow-x-auto border border-gray-200 rounded-md bg-white">
            <table className="text-[11px] font-mono border-collapse">
              <tbody>
                <tr className="align-top">
                  {availableColumns.map(col => (
                    <td key={col.name + '-name'} className="px-2 py-1 font-semibold text-gray-700 whitespace-nowrap border-b border-gray-100 min-w-[6rem]">{col.name}</td>
                  ))}
                </tr>
                <tr className="align-top">
                  {availableColumns.map(col => (
                    <td key={col.name + '-type'} className="px-2 py-1 text-gray-500 whitespace-nowrap min-w-[6rem]">{col.dataType}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <div className="text-[10px] text-gray-400 mt-1">Scroll horizontally to view all {availableColumns.length} column(s).</div>
        </div>
      </div>

      {/* Filter Conditions */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-md font-medium text-gray-800">Filter Conditions</h4>
          <button
            onClick={handleAddCondition}
            className="px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600"
          >
            Add Condition
          </button>
        </div>

        {conditions.map((condition, index) => (
          <div key={condition.id} className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg w-full">
            {index > 0 && (
              <select
                value={logic}
                onChange={(e) => setLogic(e.target.value as 'and' | 'or')}
                className="px-2 py-1 border border-gray-300 rounded text-sm"
              >
                <option value="and">AND</option>
                <option value="or">OR</option>
              </select>
            )}

            {/* Negate and Regex toggles at the front */}
            <label className="flex items-center gap-1 text-xs text-gray-700">
              <input
                aria-label="negate condition"
                type="checkbox"
                checked={Boolean(condition.negate)}
                onChange={(e) => handleConditionChange(condition.id, 'negate' as any, e.target.checked)}
              />
              negate
            </label>
            {(condition.dataType === 'string' && condition.operator === 'contains') && (
              <label className="flex items-center gap-1 text-xs text-gray-700">
                <input
                  aria-label="use regex"
                  type="checkbox"
                  checked={Boolean(condition.regex ?? true)}
                  onChange={(e) => handleConditionChange(condition.id, 'regex' as any, e.target.checked)}
                />
                regex
              </label>
            )}
            
            <select
              value={condition.column}
              onChange={(e) => handleConditionChange(condition.id, 'column', e.target.value)}
              className="px-2 py-1 border border-gray-300 rounded text-sm flex-grow min-w-[10rem]"
            >
              <option value="">Select Column</option>
              {availableColumns.map((col) => (
                <option key={col.name} value={col.name}>
                  {col.name} ({col.dataType})
                </option>
              ))}
            </select>

            <select
              value={condition.operator}
              onChange={(e) => handleConditionChange(condition.id, 'operator', e.target.value)}
              disabled={!condition.column}
              className={`px-2 py-1 border border-gray-300 rounded text-sm flex-none w-32 text-ellipsis ${
                !condition.column ? 'bg-gray-100 text-gray-500' : ''
              }`}
            >
              {!condition.column ? (
                <option value="">Please select a column first</option>
              ) : (
                getOperatorsForType(condition.dataType || 'string').map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))
              )}
            </select>

            {condition.operator !== 'is_null' && (
              <div className="flex-none">
                {renderValueInput(condition)}
              </div>
            )}

            {conditions.length > 1 && (
              <button
                onClick={() => handleRemoveCondition(condition.id)}
                className="px-2 py-1 bg-red-500 text-white text-sm rounded hover:bg-red-600"
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>

      {/* New Node Name */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          New Node Name
        </label>
        <input
          type="text"
          value={newNodeName}
          onChange={(e) => setNewNodeName(e.target.value)}
          placeholder="Enter name for filtered data"
          className="w-full px-3 py-2 border border-gray-300 rounded-md"
        />
      </div>

      {/* Apply Button */}
      <button
        onClick={handleApplyFilter}
        disabled={isFiltering || isLoading.operations}
        className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
      >
        {isFiltering ? 'Applying Filter...' : 'Apply Filter'}
      </button>
    </div>
  );
};

export default FilterTab;
