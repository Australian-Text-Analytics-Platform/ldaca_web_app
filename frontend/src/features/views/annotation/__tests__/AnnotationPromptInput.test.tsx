import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  AnnotationPromptInput,
  DEFAULT_ANNOTATION_PROMPT,
} from '../components/AnnotationPromptInput';

// Stateful host so the controlled textarea actually updates as the user types
// or accepts the default, exercising the ghost-default + Tab flow end to end.
function Harness({
  defaultPrompt = DEFAULT_ANNOTATION_PROMPT,
  initial = '',
  disabled = false,
  onCommit,
}: {
  defaultPrompt?: string;
  initial?: string;
  disabled?: boolean;
  onCommit?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <AnnotationPromptInput
      id="prompt"
      value={value}
      onChange={setValue}
      onCommit={onCommit}
      defaultPrompt={defaultPrompt}
      disabled={disabled}
    />
  );
}

describe('AnnotationPromptInput', () => {
  it('uses a batch-oriented default instruction without overriding the JSON contract', () => {
    expect(DEFAULT_ANNOTATION_PROMPT).toBe(
      'You are an expert text annotator. You will be given one or more texts and a list of ' +
        'candidate classes, each with a short description. Read each text carefully and assign ' +
        'exactly one class that best fits its meaning.',
    );
  });

  it('shows the default prompt grayed as the placeholder while empty', () => {
    render(<Harness defaultPrompt="DEFAULT PROMPT" />);

    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue('');
    expect(textarea).toHaveAttribute('placeholder', 'DEFAULT PROMPT');
    // The Tab hint is offered only while empty.
    expect(screen.getByText('Tab')).toBeInTheDocument();
  });

  it('lets the user type their own prompt and hides the hint once there is content', async () => {
    const user = userEvent.setup();
    render(<Harness defaultPrompt="DEFAULT PROMPT" />);

    const textarea = screen.getByRole('textbox');
    await user.click(textarea);
    await user.type(textarea, 'classify the sentiment');

    expect(textarea).toHaveValue('classify the sentiment');
    expect(screen.queryByText('Tab')).not.toBeInTheDocument();
  });

  it('populates the default prompt on Tab when empty and keeps focus for editing', async () => {
    const user = userEvent.setup();
    render(<Harness defaultPrompt="A DEFAULT PROMPT TO EDIT" />);

    const textarea = screen.getByRole('textbox');
    await user.click(textarea);
    await user.keyboard('{Tab}');

    // Tab filled the field with the default and did not move focus away.
    expect(textarea).toHaveValue('A DEFAULT PROMPT TO EDIT');
    expect(textarea).toHaveFocus();
  });

  it('leaves Tab alone once the field already has content', async () => {
    const user = userEvent.setup();
    render(<Harness defaultPrompt="DEFAULT" initial="my prompt" />);

    const textarea = screen.getByRole('textbox');
    await user.click(textarea);
    await user.keyboard('{Tab}');

    // The default is not injected over existing content; Tab moves focus instead.
    expect(textarea).toHaveValue('my prompt');
    expect(textarea).not.toHaveFocus();
  });

  it('commits the typed prompt on blur (save-on-blur persistence)', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<Harness defaultPrompt="DEFAULT" onCommit={onCommit} />);

    const textarea = screen.getByRole('textbox');
    await user.click(textarea);
    await user.type(textarea, 'label the topic');
    // Not persisted mid-typing — only on blur.
    expect(onCommit).not.toHaveBeenCalled();

    await user.tab();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('label the topic');
  });
});
