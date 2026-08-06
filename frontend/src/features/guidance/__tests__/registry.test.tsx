import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CONTEXTUAL_HINT_IDS, contextualHintRegistry, contextualHintSequences } from '../registry';

const addDataBlockHint = contextualHintRegistry.find(
  (definition) => definition.id === CONTEXTUAL_HINT_IDS.dataLoader.addDataBlock,
);

function resolveAddDataBlockTarget() {
  if (typeof addDataBlockHint?.target !== 'function') {
    throw new Error('The Add Data Block hint must use a dynamic target');
  }

  return addDataBlockHint.target();
}

describe('Data Loader guidance registry', () => {
  it('targets the first enabled Add action with automatic placement', () => {
    render(
      <>
        <button type="button" data-guidance="add-data-block" disabled>
          Disabled Add
        </button>
        <button type="button" data-guidance="add-data-block">
          Enabled Add
        </button>
        <div data-guidance="file-library-toolbar">File toolbar</div>
      </>,
    );

    expect(addDataBlockHint?.placement).toBe('auto');
    expect(resolveAddDataBlockTarget()).toBe(screen.getByRole('button', { name: 'Enabled Add' }));
  });

  it('falls back to the file-list toolbar when no enabled Add action is mounted', () => {
    render(
      <>
        <button type="button" data-guidance="add-data-block" disabled>
          Disabled Add
        </button>
        <div data-guidance="file-library-toolbar">File toolbar</div>
      </>,
    );

    expect(resolveAddDataBlockTarget()).toBe(screen.getByText('File toolbar'));
  });

  it('defines 50 unique, automatically placed hints in exactly one view sequence', () => {
    const ids = contextualHintRegistry.map((definition) => definition.id);
    const sequencedIds = Object.values(contextualHintSequences).flat();

    expect(ids).toHaveLength(50);
    expect(new Set(ids).size).toBe(50);
    expect(sequencedIds).toHaveLength(50);
    expect(new Set(sequencedIds)).toEqual(new Set(ids));
    expect(contextualHintRegistry.every((definition) => definition.placement === 'auto')).toBe(
      true,
    );
  });
});
