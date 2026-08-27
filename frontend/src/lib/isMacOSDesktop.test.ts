import { describe, expect, it } from 'vitest';
import { isMacOSDesktop } from './isMacOSDesktop';

describe('isMacOSDesktop', () => {
  it('recognizes the macOS Tauri webview', () => {
    expect(
      isMacOSDesktop(
        { protocol: 'tauri:', hostname: 'localhost' },
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      ),
    ).toBe(true);
  });

  it('does not add native chrome to macOS browser deployments', () => {
    expect(
      isMacOSDesktop(
        { protocol: 'https:', hostname: 'wordflow.example' },
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      ),
    ).toBe(false);
  });

  it('does not add macOS chrome to Windows Tauri builds', () => {
    expect(
      isMacOSDesktop(
        { protocol: 'https:', hostname: 'tauri.localhost' },
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      ),
    ).toBe(false);
  });
});
