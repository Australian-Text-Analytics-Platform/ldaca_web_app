import type { ReactNode } from 'react';
/** Application frame that reserves the shared Wordflow navigation header. */
export function DesktopWindowFrame({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="application-window-frame"
      className="app-titlebar-backplane flex h-dvh flex-col overflow-hidden"
      style={{ ['--desktop-titlebar-height' as string]: '35px' }}
    >
      <div
        data-testid="application-header-spacer"
        data-tauri-drag-region="deep"
        aria-hidden="true"
        className="app-titlebar-backplane h-(--desktop-titlebar-height) shrink-0 select-none"
      />
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
