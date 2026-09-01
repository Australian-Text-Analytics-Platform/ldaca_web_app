import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isMacOSDesktop } from './isMacOSDesktop';
import {
  initializeDesktopWindowMaterial,
  NATIVE_GLASS_ACTIVE_VALUE,
  NATIVE_GLASS_ATTRIBUTE,
} from './desktopWindowMaterial';
import { GlassMaterialVariant, setLiquidGlassEffect } from 'tauri-plugin-liquid-glass-api';

vi.mock('./isMacOSDesktop', () => ({ isMacOSDesktop: vi.fn() }));
vi.mock('tauri-plugin-liquid-glass-api', () => ({
  GlassMaterialVariant: { Clear: 1 },
  setLiquidGlassEffect: vi.fn(),
}));

const mockedIsMacOSDesktop = vi.mocked(isMacOSDesktop);
const mockedSetLiquidGlassEffect = vi.mocked(setLiquidGlassEffect);

describe('initializeDesktopWindowMaterial', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.removeAttribute(NATIVE_GLASS_ATTRIBUTE);
  });

  it('enables Clear native glass with no tint on macOS desktop', async () => {
    mockedIsMacOSDesktop.mockReturnValue(true);

    await initializeDesktopWindowMaterial();

    expect(mockedSetLiquidGlassEffect).toHaveBeenCalledOnce();
    expect(mockedSetLiquidGlassEffect).toHaveBeenCalledWith({
      cornerRadius: 0,
      variant: GlassMaterialVariant.Clear,
    });
    expect(document.documentElement.getAttribute(NATIVE_GLASS_ATTRIBUTE)).toBe(
      NATIVE_GLASS_ACTIVE_VALUE,
    );
  });

  it('fails opaque when macOS native glass initialization rejects', async () => {
    mockedIsMacOSDesktop.mockReturnValue(true);
    mockedSetLiquidGlassEffect.mockRejectedValueOnce(new Error('native effect unavailable'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await initializeDesktopWindowMaterial();

    expect(document.documentElement).not.toHaveAttribute(NATIVE_GLASS_ATTRIBUTE);
    expect(warning).toHaveBeenCalledWith(
      'Native window glass could not be initialized; retaining opaque backgrounds.',
      expect.any(Error),
    );
    warning.mockRestore();
  });

  it('leaves browser and non-macOS rendering unchanged', async () => {
    mockedIsMacOSDesktop.mockReturnValue(false);

    await initializeDesktopWindowMaterial();

    expect(mockedSetLiquidGlassEffect).not.toHaveBeenCalled();
    expect(document.documentElement).not.toHaveAttribute(NATIVE_GLASS_ATTRIBUTE);
  });
});
