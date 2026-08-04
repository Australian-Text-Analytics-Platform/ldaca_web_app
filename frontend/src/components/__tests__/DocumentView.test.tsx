import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import DocumentView from '@/components/DocumentView';

const docsConfig = vi.hoisted(() => ({ baseUrl: 'https://docs.example.com/wordflow/v0.7' }));

vi.mock('@/config/env', () => ({
  APP_VERSION: '0.7.1',
  APP_BUILD_DATE: '04/Aug/2026',
  APP_BUILD: 'abc1234',
  getDocsBaseUrl: () => docsConfig.baseUrl,
}));

vi.mock('sonner', () => ({
  toast: vi.fn(),
}));

const target = {
  kind: 'tutorial' as const,
  key: 'index',
  file: 'tutorials/index.md',
  anchor: 'help-tutorial-index',
};

describe('DocumentView (docType="tutorial")', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    docsConfig.baseUrl = 'https://docs.example.com/wordflow/v0.7';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('uses remote Markdown before the bundled copy', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('# Remote tutorial'),
    });

    const { rerender } = render(<DocumentView docType="tutorial" target={target} />);

    expect(await screen.findByRole('heading', { name: 'Remote tutorial' })).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(global.fetch).mock.calls[0]?.[0])).toBe(
      'https://docs.example.com/wordflow/v0.7/tutorials/index.md',
    );

    rerender(
      <DocumentView docType="tutorial" target={{ ...target, anchor: 'help-tutorial-index-2' }} />,
    );
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  });

  it('falls back to bundled Markdown when the matching remote tag is absent', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('# Bundled tutorial'),
      });

    render(<DocumentView docType="tutorial" target={target} />);

    expect(await screen.findByRole('heading', { name: 'Bundled tutorial' })).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(String(vi.mocked(global.fetch).mock.calls[1]?.[0])).not.toContain('docs.example.com');
  });

  it('uses bundled Markdown directly when no docs origin is configured', async () => {
    docsConfig.baseUrl = '';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('# Offline tutorial'),
    });

    render(<DocumentView docType="tutorial" target={target} />);

    expect(await screen.findByRole('heading', { name: 'Offline tutorial' })).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(global.fetch).mock.calls[0]?.[0])).not.toContain('docs.example.com');
  });

  it('resolves documentation assets from the source that supplied the Markdown', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('![Remote chart](tutorials/assets/chart.png)'),
    });

    render(<DocumentView docType="tutorial" target={target} />);

    expect(await screen.findByRole('img', { name: 'Remote chart' })).toHaveAttribute(
      'src',
      'https://docs.example.com/wordflow/v0.7/tutorials/assets/chart.png',
    );
  });
});
