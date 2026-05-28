import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { DemoSnapshotsToggleItem } from '../components/DemoSnapshotsToggleItem';

/**
 * Hosts the menu item inside an open Radix dropdown for interaction tests.
 * Used by: Vitest setup or assertions in snapshot-view/DemoSnapshotsToggleItem.
 * Why: because the test needs a stable fixture or assertion target for this scoped behavior without live workspace state.
 */
function Harness() {
  return (
    <DropdownMenu open>
      <DropdownMenuTrigger>open</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DemoSnapshotsToggleItem />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

describe('DemoSnapshotsToggleItem', () => {
  let originalSnapshot: ReturnType<typeof usePreferencesStore.getState>;

  beforeEach(() => {
    originalSnapshot = usePreferencesStore.getState();
    // Force a deterministic starting state — the store's persist
    // middleware otherwise carries values across tests.
    act(() => {
      usePreferencesStore.getState().setDemoSnapshotsEnabled(false);
    });
  });

  afterEach(() => {
    act(() => {
      usePreferencesStore.setState(originalSnapshot, true);
    });
  });

  it('renders unchecked when demoSnapshotsEnabled is false', () => {
    render(<Harness />);
    const item = screen.getByRole('menuitemcheckbox', {
      name: /enable demo snapshots/i,
    });
    expect(item.getAttribute('aria-checked')).toBe('false');
  });

  it('toggles the preference when selected', () => {
    render(<Harness />);
    const item = screen.getByRole('menuitemcheckbox', {
      name: /enable demo snapshots/i,
    });

    fireEvent.click(item);
    expect(usePreferencesStore.getState().demoSnapshotsEnabled).toBe(true);
  });

  it('renders checked when the preference is already on', () => {
    act(() => {
      usePreferencesStore.getState().setDemoSnapshotsEnabled(true);
    });
    render(<Harness />);
    const item = screen.getByRole('menuitemcheckbox', {
      name: /enable demo snapshots/i,
    });
    expect(item.getAttribute('aria-checked')).toBe('true');
  });
});
