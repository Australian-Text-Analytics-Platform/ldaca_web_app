import { describe, expect, it, vi } from 'vitest';

import {
  blockUnhandledExternalFileDrop,
  installExternalFileDropGuard,
  isExternalFileDrag,
} from '../externalFileDropGuard';

function dragEvent(type: 'dragover' | 'drop', types?: string[]) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  if (types) {
    Object.defineProperty(event, 'dataTransfer', {
      configurable: true,
      value: { types },
    });
  }
  return event;
}

describe('external file drop guard', () => {
  it('recognizes only drags that advertise external files', () => {
    expect(isExternalFileDrag({ types: ['Files'] })).toBe(true);
    expect(isExternalFileDrag({ types: ['text/plain', 'Files'] })).toBe(true);
    expect(isExternalFileDrag({ types: ['application/x-ldaca-file-path'] })).toBe(false);
    expect(isExternalFileDrag({ types: ['text/plain'] })).toBe(false);
    expect(isExternalFileDrag({ types: ['text/uri-list'] })).toBe(false);
    expect(isExternalFileDrag({ types: [] })).toBe(false);
    expect(isExternalFileDrag(null)).toBe(false);
    expect(isExternalFileDrag(undefined)).toBe(false);
  });

  it.each(['dragover', 'drop'] as const)('cancels an unhandled external-file %s', (type) => {
    const event = dragEvent(type, ['Files']);

    blockUnhandledExternalFileDrop(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it.each([
    ['internal drag', ['application/x-ldaca-file-path']],
    ['text drag', ['text/plain']],
    ['URL drag', ['text/uri-list']],
    ['empty drag', []],
    ['missing transfer data', undefined],
  ])('leaves an unhandled %s untouched', (_label, types) => {
    const event = dragEvent('drop', types);

    blockUnhandledExternalFileDrop(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it('does not handle an external-file event already accepted by a drop target', () => {
    const event = dragEvent('drop', ['Files']);
    event.preventDefault();
    const preventDefault = vi.spyOn(event, 'preventDefault');

    blockUnhandledExternalFileDrop(event);

    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('installs and disposes the same bubble-phase listeners', () => {
    const addEventListener = vi.spyOn(window, 'addEventListener');
    const removeEventListener = vi.spyOn(window, 'removeEventListener');

    const dispose = installExternalFileDropGuard(window);

    expect(addEventListener).toHaveBeenCalledWith('dragover', blockUnhandledExternalFileDrop);
    expect(addEventListener).toHaveBeenCalledWith('drop', blockUnhandledExternalFileDrop);

    dispose();

    expect(removeEventListener).toHaveBeenCalledWith('dragover', blockUnhandledExternalFileDrop);
    expect(removeEventListener).toHaveBeenCalledWith('drop', blockUnhandledExternalFileDrop);

    addEventListener.mockRestore();
    removeEventListener.mockRestore();
  });
});
