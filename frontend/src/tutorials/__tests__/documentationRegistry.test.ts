import { beforeEach, describe, expect, it } from 'vitest';

import { BUNDLED_REGISTRY } from '../bundledRegistry';
import { getDocumentTarget } from '../documentationRegistry';
import { useRegistryStore } from '../registryStore';

describe('getDocumentTarget', () => {
  beforeEach(() => {
    useRegistryStore.setState({
      registry: {
        tutorial: { ...BUNDLED_REGISTRY.tutorial },
        info: { ...BUNDLED_REGISTRY.info },
        reference: { ...BUNDLED_REGISTRY.reference },
      },
      meta: null,
    });
  });

  it('returns one target contract with kind, key, path, anchor, and label', () => {
    expect(getDocumentTarget('tutorial', 'ui.tool-choice')).toEqual({
      kind: 'tutorial',
      key: 'ui.tool-choice',
      file: 'tutorials/ui.md',
      anchor: 'help-ui-tool-choice',
      label: 'Tool Choice',
    });
  });

  it('uses the same contract for remote-only and missing targets', () => {
    useRegistryStore.getState().applyRemote({
      info: {
        'remote-only': {
          file: 'information/remote.md',
          anchor: 'info-remote',
        },
      },
    });

    expect(getDocumentTarget('info', 'remote-only')).toEqual({
      kind: 'info',
      key: 'remote-only',
      file: 'information/remote.md',
      anchor: 'info-remote',
    });
    expect(getDocumentTarget('reference', 'missing')).toBeNull();
  });
});
