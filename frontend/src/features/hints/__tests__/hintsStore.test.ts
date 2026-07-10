import { describe, it, expect, beforeEach } from 'vitest';
import { useHintsStore } from '@/stores/hintsStore';

describe('hintsStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useHintsStore.setState({
      dismissedHints: [],
      sessionDismissedHints: [],
      lastUploadedFilePath: null,
      hintsEnabled: true,
    });
  });

  it('starts enabled with no dismissals', () => {
    const state = useHintsStore.getState();
    expect(state.hintsEnabled).toBe(true);
    expect(state.dismissedHints).toEqual([]);
  });

  it('dismissHint adds to the persisted list once', () => {
    const { dismissHint } = useHintsStore.getState();
    dismissHint('a');
    dismissHint('a');
    dismissHint('b');
    expect(useHintsStore.getState().dismissedHints).toEqual(['a', 'b']);
    const persisted = JSON.parse(localStorage.getItem('ldaca-hints') ?? '{}');
    expect(persisted.state.dismissedHints).toEqual(['a', 'b']);
  });

  it('resetHints clears dismissals', () => {
    const { dismissHint, resetHints } = useHintsStore.getState();
    dismissHint('a');
    resetHints();
    expect(useHintsStore.getState().dismissedHints).toEqual([]);
  });

  it('setHintsEnabled toggles the master switch', () => {
    const { setHintsEnabled } = useHintsStore.getState();
    setHintsEnabled(false);
    expect(useHintsStore.getState().hintsEnabled).toBe(false);
    setHintsEnabled(true);
    expect(useHintsStore.getState().hintsEnabled).toBe(true);
  });

  it('owns session dismissals and upload context without persisting them', () => {
    const { dismissHintForSession, setLastUploadedFilePath } = useHintsStore.getState();
    dismissHintForSession('session-only');
    setLastUploadedFilePath('/tmp/upload.csv');

    expect(useHintsStore.getState().sessionDismissedHints).toEqual(['session-only']);
    expect(useHintsStore.getState().lastUploadedFilePath).toBe('/tmp/upload.csv');

    const persisted = JSON.parse(localStorage.getItem('ldaca-hints') ?? '{}');
    expect(persisted.state).not.toHaveProperty('sessionDismissedHints');
    expect(persisted.state).not.toHaveProperty('lastUploadedFilePath');
  });
});
