import type React from 'react';

interface PlaceholderTabFillArgs {
  event: React.KeyboardEvent<HTMLInputElement>;
  value: string;
  setValue: (value: string) => void;
}

/**
 * Restores the caret after a placeholder is accepted without moving focus.
 * Used by: local callers in preprocessing/placeholderTabFill module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 */
const scheduleCaretRestore = (input: HTMLInputElement, value: string) => {
  /**
   * Repositions the caret only if focus remains in the accepted input.
   * Called by: scheduleCaretRestore internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const restore = () => {
    if (document.activeElement !== input) {
      return;
    }
    input.setSelectionRange(value.length, value.length);
  };

  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(restore);
    return;
  }

  setTimeout(restore, 0);
};

/**
 * Lets generated-name fields accept their placeholder with Tab. Preprocessing
 * forms use this so users can quickly adopt suggested output names.
 * Used by: JoinSubTab module, ConcatSubTab module, SliceSubTab module (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 * Flow: ignore modified Tab presses and non-empty fields, copy a trimmed placeholder into state, then restore the caret after React updates.
 */
export const acceptPlaceholderOnTab = ({ event, value, setValue }: PlaceholderTabFillArgs) => {
  if (event.key !== 'Tab' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
    return;
  }

  if (value.trim().length > 0) {
    return;
  }

  const placeholder = event.currentTarget.placeholder.trim();
  if (!placeholder) {
    return;
  }

  event.preventDefault();
  setValue(placeholder);
  scheduleCaretRestore(event.currentTarget, placeholder);
};
