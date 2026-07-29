import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkDesktopUpdate } from '../desktopUpdaterRuntime';

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: mocks.check,
}));

describe('desktopUpdaterRuntime', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('rejects a check that does not settle before the UI deadline', async () => {
    vi.useFakeTimers();
    mocks.check.mockReturnValue(new Promise(() => undefined));

    const result = checkDesktopUpdate();
    const rejection = expect(result).rejects.toThrow('The update check timed out.');
    await vi.advanceTimersByTimeAsync(15_000);

    await rejection;
    expect(mocks.check).toHaveBeenCalledWith({ timeout: 15_000 });
  });
});
