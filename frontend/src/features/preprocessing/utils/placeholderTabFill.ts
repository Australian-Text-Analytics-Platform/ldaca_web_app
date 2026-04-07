import type React from 'react';

interface PlaceholderTabFillArgs {
  event: React.KeyboardEvent<HTMLInputElement>;
  value: string;
  setValue: (value: string) => void;
}

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

  setValue(placeholder);
};