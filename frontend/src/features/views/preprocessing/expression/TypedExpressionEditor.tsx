import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';

const extensions = [EditorView.lineWrapping];

// Match the VS Code input geometry and semantic theme tokens.
const baseTheme = EditorView.theme({
  '&': {
    color: 'var(--vscode-input-foreground)',
    fontSize: 'var(--vscode-fontSize-body1)',
    borderRadius: 'var(--vscode-cornerRadius-small)',
    border: '1px solid var(--vscode-input-border)',
    backgroundColor: 'var(--vscode-input-background)',
  },
  '&.cm-focused': {
    outline: '1px solid var(--vscode-focusBorder)',
    outlineOffset: '0',
  },
  '.cm-content': {
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    padding: '4px 0',
    minHeight: '3.5rem',
  },
  '.cm-line': {
    padding: '0 6px',
  },
  '.cm-gutters': {
    display: 'none',
  },
  '.cm-placeholder': {
    color: 'var(--vscode-input-placeholderForeground)',
    fontStyle: 'normal',
  },
  '.cm-activeLine': {
    backgroundColor: 'transparent',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'var(--vscode-editor-selectionBackground) !important',
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
