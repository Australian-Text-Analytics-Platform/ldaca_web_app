/* eslint-disable testing-library/no-container, testing-library/no-node-access -- this primitive exposes no semantic scrollbar role */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ScrollArea } from '../scroll-area';

describe('ScrollArea', () => {
  it('keeps the horizontal rail visible while leaving vertical visibility to scrolling', () => {
    const { container } = render(
      <ScrollArea scrollbars="both">
        <div>Scrollable content</div>
      </ScrollArea>,
    );

    const horizontal = container.querySelector(
      '[data-slot="scroll-area-scrollbar"][data-orientation="horizontal"]',
    );
    const vertical = container.querySelector(
      '[data-slot="scroll-area-scrollbar"][data-orientation="vertical"]',
    );

    expect(horizontal).toHaveAttribute('data-state', 'hidden');
    expect(horizontal).not.toHaveClass('data-[state=hidden]:hidden');
    expect(vertical).not.toBeInTheDocument();
  });
});
