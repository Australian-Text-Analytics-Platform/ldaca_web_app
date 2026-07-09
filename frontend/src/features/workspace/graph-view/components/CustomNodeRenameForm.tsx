interface CustomNodeRenameFormProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: (event: React.SyntheticEvent) => void;
  onCancel: () => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
}

/**
 * Inline rename form for graph nodes.
 * Used by: CustomNode's full-card header because rename input events must stay
 * isolated from React Flow drag/select handlers while still submitting through
 * the parent node mutation callback.
 */
export function CustomNodeRenameForm({
  inputRef,
  value,
  onValueChange,
  onSubmit,
  onCancel,
  onKeyDown,
}: CustomNodeRenameFormProps) {
  const stopGraphEvent = (event: React.SyntheticEvent) => {
    event.stopPropagation();
  };

  return (
    <form onSubmit={onSubmit} className="flex-1 relative z-50">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(event) => {
          onValueChange(event.target.value);
        }}
        onBlur={onCancel}
        onKeyDown={onKeyDown}
        onMouseDown={stopGraphEvent}
        onClick={stopGraphEvent}
        onPointerDown={stopGraphEvent}
        className="nodrag nopan relative z-50 w-full rounded border border-blue-300 bg-white px-1 py-0.5 text-sm font-bold focus:outline-hidden focus:ring-1 focus:ring-blue-500"
        style={{
          fontSize: '14px',
          lineHeight: '1.2',
        }}
      />
    </form>
  );
}
