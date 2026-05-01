import type React from 'react';

interface PlaceholderTabFillArgs {
  event: React.KeyboardEvent<HTMLInputElement>;
  value: string;
  setValue: (value: string) => void;
}

const scheduleCaretRestore = (input: HTMLInputElement, value: string) => {
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