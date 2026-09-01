import { isMacOSDesktop } from '@/lib/isMacOSDesktop';

export const NATIVE_GLASS_ATTRIBUTE = 'data-native-glass';
export const NATIVE_GLASS_ACTIVE_VALUE = 'active';

/** Initialize the macOS-only native window backplane before React renders. */
export async function initializeDesktopWindowMaterial(): Promise<void> {
  if (!isMacOSDesktop()) {
    return;
  }

  try {
    const { GlassMaterialVariant, setLiquidGlassEffect } = await import(
      'tauri-plugin-liquid-glass-api'
    );
    await setLiquidGlassEffect({
      cornerRadius: 0,
      variant: GlassMaterialVariant.Clear,
    });
    document.documentElement.setAttribute(NATIVE_GLASS_ATTRIBUTE, NATIVE_GLASS_ACTIVE_VALUE);
  } catch (error) {
    document.documentElement.removeAttribute(NATIVE_GLASS_ATTRIBUTE);
    console.warn(
      'Native window glass could not be initialized; retaining opaque backgrounds.',
      error,
    );
  }
}
