import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useUIStore } from '@/stores/uiStore';
import { DocumentModalHost } from '../DocumentModalHost';

vi.mock('@/components/DocumentView', () => ({
  default: ({ docType, target }: { docType: string; target: { key: string } }) => (
    <div data-testid="document-view">
      {docType}:{target.key}
    </div>
  ),
}));

describe('DocumentModalHost', () => {
  beforeEach(() => {
    useUIStore.setState({ documentTarget: null });
  });

  it('uses one dialog slot for tutorial, information, and reference targets', async () => {
    const view = render(<DocumentModalHost />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    useUIStore.getState().openDocument({
      kind: 'tutorial',
      key: 'ui.tool-choice',
      file: 'tutorials/ui.md',
      anchor: 'help-ui-tool-choice',
    });
    expect(await screen.findByTestId('document-view')).toHaveTextContent('tutorial:ui.tool-choice');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);

    useUIStore.getState().openDocument({
      kind: 'info',
      key: 'general.overview',
      file: 'information/general.md',
      anchor: 'info-general-overview',
    });
    view.rerender(<DocumentModalHost />);
    expect(await screen.findByTestId('document-view')).toHaveTextContent(
      'information:general.overview',
    );
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });
});
