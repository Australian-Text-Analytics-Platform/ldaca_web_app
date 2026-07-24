import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';

const extensions = [EditorView.lineWrapping];

// Match the app's input styling (border, radius, font, focus ring)
const baseTheme = EditorView.theme({
  '&': {
    fontSize: '0.875rem',
    borderRadius: 'calc(var(--radius) - 2px)',
    border: '1px solid var(--input)',
    backgroundColor: 'var(--background)',
  },
  '&.cm-focused': {
    outline: '2px solid var(--ring)',
    outlineOffset: '1px',
  },
  '.cm-content': {
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    padding: '8px 0',
    minHeight: '3.5rem',
  },
  '.cm-line': {
    padding: '0 12px',
  },
  '.cm-gutters': {
    display: 'none',
  },
  '.cm-placeholder': {
    color: 'var(--muted-foreground)',
    fontStyle: 'normal',
  },
  '.cm-activeLine': {
    backgroundColor: 'transparent',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--ring) 25%, transparent) !important',
  },
});

interface TypedExpressionEditorProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  disabled?: boolean;
  minHeight?: string;
  className?: string;
}

/**
 * Thin CodeMirror wrapper for JSON-encoded typed expression items.
 * The editor intentionally provides no executable-language extension because
 * its content is parsed into the generated expression contract before preview
 * or apply.
 */
export function TypedExpressionEditor({
  value,
  onChange,
  onBlur,
  placeholder,
  disabled = false,
  minHeight = '3.5rem',
  className = '',
}: TypedExpressionEditorProps) {
  return (
    <div className={className}>
      <CodeMirror
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        extensions={[...extensions, baseTheme, EditorView.theme({ '.cm-content': { minHeight } })]}
        placeholder={placeholder}
        editable={!disabled}
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          indentOnInput: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: false,
          searchKeymap: false,
          history: true,
        }}
      />
    </div>
  );
}
