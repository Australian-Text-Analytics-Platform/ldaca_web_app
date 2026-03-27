import { describe, expect, it } from 'vitest';

import {
  getDefaultMetadataColumnSelection,
  reconcileMetadataColumnSelection,
} from '../metadataColumnSelection';

describe('metadataColumnSelection', () => {
  it('prefers the first available preferred column before falling back to document', () => {
    expect(
      getDefaultMetadataColumnSelection(['speaker', 'text', 'document'], ['text', 'speaker']),
    ).toEqual(['text']);
  });

  it('falls back to a literal document column when the preferred selection is unavailable', () => {
    expect(
      getDefaultMetadataColumnSelection(['speaker', 'document'], ['text']),
    ).toEqual(['document']);
  });

  it('reconciles null selections using the preferred column list', () => {
    expect(
      reconcileMetadataColumnSelection(['speaker', 'text'], null, ['text']),
    ).toEqual(['text']);
  });
});