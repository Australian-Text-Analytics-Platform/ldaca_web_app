/**
 * Prompt editor for the Annotation tab's AI mode.
 *
 * Rendered by: AnnotationFeature, in the AnnotationAiSettings Advanced content
 * below the provider/model row. It backs the instruction prompt that is sent
 * to the provider alongside the text + class descriptions.
 *
 * Ghost-default UX (what the user asked for): while the field is empty the
 * default prompt shows grayed as the textarea placeholder. From there the user
 * can either
 *   1. start typing their own prompt (the placeholder clears as usual), or
 *   2. press Tab to populate the box with the default prompt and edit from
 *      there — the caret lands at the end so they continue where it left off.
 *
 * Tab is only intercepted while the field is empty; once it holds content, Tab
 * resumes normal focus traversal so keyboard navigation isn't trapped.
 */
import { type KeyboardEvent, useRef } from 'react';
import { Textarea } from '@/components/ui/textarea';

/**
 * Canonical default annotation instruction. Exported so AnnotationFeature can
 * pass it in as the ghost/placeholder text and tests can assert against it.
 */
export const DEFAULT_ANNOTATION_PROMPT =
  'You are an expert text annotator. You will be given one or more texts and a list of ' +
  'candidate classes, each with a short description. Read each text carefully and assign ' +
  'exactly one class that best fits its meaning.';

interface AnnotationPromptInputProps {
  value: string;
  onChange: (value: string) => void;
  /**
   * Persist the current value. Fired on blur so the parent can write the prompt
   * to durable tab state without a backend round-trip on every keystroke,
   * mirroring the API-key "save on blur" behaviour.
   */
  onCommit?: (value: string) => void;
  /** Grayed default shown as the placeholder and accepted via Tab when empty. */
  defaultPrompt: string;
  disabled?: boolean;
  id?: string;
}

export function AnnotationPromptInput({
  value,
  onChange,
  onCommit,
  defaultPrompt,
  disabled,
  id,
}: AnnotationPromptInputProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const isEmpty = value.length === 0;

  // Flow: on an empty field, Tab accepts the grayed default instead of moving
  // focus; preventDefault keeps focus in the textarea, onChange commits the
  // default, then the caret is pushed to the end (after the controlled value
  // applies) so the user edits from where the prompt ends.
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Tab' && !event.shiftKey && isEmpty) {
      event.preventDefault();
      onChange(defaultPrompt);
      requestAnimationFrame(() => {
        const element = ref.current;
        if (element) {
          element.focus();
          element.setSelectionRange(defaultPrompt.length, defaultPrompt.length);
        }
      });
    }
  };

  return (
    <div className="space-y-1.5">
      <Textarea
        id={id}
        ref={ref}
        value={value}
        disabled={disabled}
        placeholder={defaultPrompt}
        className="min-h-24 text-sm leading-relaxed"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onBlur={(event) => {
          onCommit?.(event.target.value);
        }}
        onKeyDown={handleKeyDown}
      />
      {isEmpty && !disabled ? (
        <p className="text-xs text-muted-foreground">
          Press <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">Tab</kbd> to
          start from the default prompt, or just start typing your own.
        </p>
      ) : null}
    </div>
  );
}
