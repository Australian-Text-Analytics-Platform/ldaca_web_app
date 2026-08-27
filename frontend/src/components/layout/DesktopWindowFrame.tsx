import type { ReactNode } from 'react';
import { isMacOSDesktop } from '@/lib/isMacOSDesktop';

/** Main-window frame that reserves native traffic-light space on macOS Tauri only. */
export function DesktopWindowFrame({ children }: { children: ReactNode }) {
  const macOSDesktop = isMacOSDesktop();

  return (
    <div
      className="flex h-dvh flex-col overflow-hidden bg-[var(--vscode-titleBar-activeBackground)]"
      style={{
        ['--desktop-titlebar-height' as string]: macOSDesktop ? '35px' : '0px',
      }}
    >
      {macOSDesktop && (
        <div
          data-tauri-drag-region="deep"
          aria-hidden="true"
          className="h-(--desktop-titlebar-height) shrink-0 select-none bg-[var(--vscode-titleBar-activeBackground)]"
        />
      )}
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
