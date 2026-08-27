import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AnnotationColumnFilterMenu } from '../AnnotationColumnFilterMenu';

describe('AnnotationColumnFilterMenu', () => {
  it('toggles the difference condition independently of the existence radio', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <AnnotationColumnFilterMenu
        column="reviewer"
        value={{ differs: true, existence: 'off' }}
        onChange={onChange}
        differsLabel="Differs from annotation"
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Filter rows by reviewer' });
    expect(trigger).toHaveAttribute('aria-pressed', 'true');
    await user.click(trigger);
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Differs from annotation' }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'All rows' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await user.click(screen.getByRole('menuitemradio', { name: 'Has value' }));
    expect(onChange).toHaveBeenLastCalledWith({ differs: true, existence: 'present' });
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Differs from annotation' }));
    expect(onChange).toHaveBeenLastCalledWith({ differs: false, existence: 'off' });
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Clear filter' }));
    expect(onChange).toHaveBeenLastCalledWith({ differs: false, existence: 'off' });
  });

  it('greys out the difference condition when Empty is selected or no comparison exists', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <AnnotationColumnFilterMenu
        column="reviewer"
        value={{ differs: true, existence: 'off' }}
        onChange={onChange}
        differsLabel="Differs from annotation"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Filter rows by reviewer' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Empty' }));
    expect(onChange).toHaveBeenLastCalledWith({ differs: false, existence: 'empty' });

    rerender(
      <AnnotationColumnFilterMenu
        column="reviewer"
        value={{ differs: false, existence: 'empty' }}
        onChange={onChange}
        differsLabel="Differs from annotation"
      />,
    );
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Differs from annotation' }),
    ).toHaveAttribute('aria-disabled', 'true');
    await user.keyboard('{Escape}');

    rerender(
      <AnnotationColumnFilterMenu
        column="annotation"
        value={{ differs: false, existence: 'off' }}
        onChange={onChange}
        differsLabel="Differs from any comparison column"
        differsDisabled
        differsDisabledReason="Select a Compare To column first"
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Filter rows by annotation' });
    expect(trigger).toHaveAttribute('aria-pressed', 'false');
    await user.click(trigger);
    const differs = screen.getByRole('menuitemcheckbox', {
      name: 'Differs from any comparison column',
    });
    expect(differs).toHaveAttribute('aria-disabled', 'true');
    expect(differs).toHaveAttribute('title', 'Select a Compare To column first');
  });
});
