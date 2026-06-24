import { describe, expect, it } from 'vitest';
import { deriveSliceFormModel } from '../sliceFormModel';

const baseInput = {
  selectedNodeId: 'node-1',
  selectedNodeLabel: 'Source Rows',
  nodeRowCount: 100,
  isSlicing: false,
  isOperationsLoading: false,
} as const;

describe('deriveSliceFormModel', () => {
  it('builds a slice payload only after offset and length are valid', () => {
    const model = deriveSliceFormModel({
      ...baseInput,
      mode: 'slice',
      offsetInput: '5',
      lengthInput: '10',
      sampleSizeInput: '',
      randomSeedInput: '42',
      noRandomSeed: false,
    });

    expect(model.hasOperation).toBe(true);
    expect(model.operationPayload).toEqual({ mode: 'slice', offset: 5, length: 10 });
    expect(model.previewReady).toBe(true);
    expect(model.applyDisabled).toBe(false);
    expect(model.rangeSummary).toBe('Rows 5–14 inclusive (10 total).');
  });

  it('allows original-row preview for a slice offset before length is valid', () => {
    const model = deriveSliceFormModel({
      ...baseInput,
      mode: 'slice',
      offsetInput: '5',
      lengthInput: '',
      sampleSizeInput: '',
      randomSeedInput: '42',
      noRandomSeed: false,
    });

    expect(model.hasOperation).toBe(false);
    expect(model.operationPayload).toBeNull();
    expect(model.previewReady).toBe(true);
    expect(model.applyDisabled).toBe(true);
    expect(model.applyDisabledReason).toBe('Enter a length (number of rows to include)');
  });

  it('turns a full-row random sample into a shuffle request with seed', () => {
    const model = deriveSliceFormModel({
      ...baseInput,
      mode: 'random_sample',
      offsetInput: '0',
      lengthInput: '',
      sampleSizeInput: '100',
      randomSeedInput: '7',
      noRandomSeed: false,
    });

    expect(model.isFullShuffle).toBe(true);
    expect(model.operationPayload).toEqual({ mode: 'shuffle', random_seed: 7 });
    expect(model.autoNodeName).toContain('shuffle');
    expect(model.applyDisabled).toBe(false);
  });

  it('validates random sample size and optional seed independently', () => {
    const invalidSize = deriveSliceFormModel({
      ...baseInput,
      mode: 'random_sample',
      offsetInput: '0',
      lengthInput: '',
      sampleSizeInput: '25.5',
      randomSeedInput: '42',
      noRandomSeed: false,
    });

    expect(invalidSize.sampleSizeHint).toBe(
      'Values ≥ 1 must be whole numbers (e.g. 25, not 25.5).',
    );
    expect(invalidSize.applyDisabledReason).toBe(
      'Enter a valid sample size — a fraction (0–1) or a whole number ≥ 1',
    );

    const noSeed = deriveSliceFormModel({
      ...baseInput,
      mode: 'random_sample',
      offsetInput: '0',
      lengthInput: '',
      sampleSizeInput: '0.25',
      randomSeedInput: '',
      noRandomSeed: true,
    });

    expect(noSeed.randomSeedValid).toBe(true);
    expect(noSeed.randomSeedValue).toBeUndefined();
    expect(noSeed.operationPayload).toEqual({ mode: 'random_sample', sample_size: 0.25 });
    expect(noSeed.rangeSummary).toBe('Random sample using fraction 0.25.');
  });
});
