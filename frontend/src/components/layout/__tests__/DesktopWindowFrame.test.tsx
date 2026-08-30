import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DesktopWindowFrame } from '../DesktopWindowFrame';

describe('DesktopWindowFrame', () => {
  it('reserves the shared 35px application header in every runtime', () => {
    render(
      <DesktopWindowFrame>
        <main>Wordflow content</main>
      </DesktopWindowFrame>,
    );

    expect(screen.getByTestId('application-window-frame')).toHaveStyle({
      '--desktop-titlebar-height': '35px',
    });
    expect(screen.getByTestId('application-header-spacer')).toHaveAttribute(
      'data-tauri-drag-region',
      'deep',
    );
    expect(screen.getByText('Wordflow content')).toBeVisible();
  });
});
