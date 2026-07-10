import type { SliceRequest as SliceRequestPayload } from '@/api';
import { buildSamplingAutoNodeName } from '@/features/views/common/samplingAutoNodeName';

export type SamplingMode = 'slice' | 'random_sample';

export interface SliceFormModelInput {
  selectedNodeId: string | null;
  selectedNodeLabel: string;
  nodeRowCount: number | null;
  mode: SamplingMode;
  offsetInput: string;
  lengthInput: string;
  sampleSizeInput: string;
  randomSeedInput: string;
  noRandomSeed: boolean;
  isSlicing: boolean;
  isOperationsLoading: boolean;
}

export interface SliceFormModel {
  offsetNumber: number;
  offsetValid: boolean;
  lengthNumber: number | null;
  lengthValid: boolean;
  lengthValue: number | undefined;
  sampleSizeNumber: number | null;
  sampleSizeValid: boolean;
  sampleSizeValue: number | undefined;
  sampleSizeHint: string | null;
  randomSeedNumber: number | null;
  randomSeedValid: boolean;
  randomSeedValue: number | undefined;
  hasSelection: boolean;
  hasOperation: boolean;
  isFullShuffle: boolean;
  formSignature: string;
  resultSignature: string;
  autoNodeName: string;
  rangeSummary: string;
  previewReady: boolean;
  previewReadyMessage: string;
  operationPayload: SliceRequestPayload | null;
  applyDisabled: boolean;
  applyDisabledReason: string | undefined;
}

/**
 * Serializes slice/random-sample form values into the backend request shape.
 * Used by: `deriveSliceFormModel` for preview payloads and `useSliceSubTab`
 * for apply requests so both paths keep the same backend contract.
 */
export const buildSlicePayload = ({
  mode,
  offset,
  lengthValue,
  sampleSizeValue,
  randomSeedValue,
  isFullShuffle,
}: {
  mode: SamplingMode;
  offset: number;
  lengthValue?: number;
  sampleSizeValue?: number;
  randomSeedValue?: number;
  isFullShuffle?: boolean;
}): SliceRequestPayload => {
  if (mode === 'random_sample') {
    if (isFullShuffle) {
      const payload: SliceRequestPayload = { mode: 'shuffle' };
      if (typeof randomSeedValue === 'number') {
        payload.random_seed = randomSeedValue;
      }
      return payload;
    }
    const payload: SliceRequestPayload = { mode };
    if (typeof sampleSizeValue === 'number') {
      payload.sample_size = sampleSizeValue;
    }
    if (typeof randomSeedValue === 'number') {
      payload.random_seed = randomSeedValue;
    }
    return payload;
  }
  const payload: SliceRequestPayload = { mode };
  payload.offset = offset;
  if (typeof lengthValue === 'number') {
    payload.length = lengthValue;
  }
  return payload;
};

/**
 * Derives all display, validation, and backend-request state for Sample Rows.
 * Used by: `useSliceSubTab`, which owns form state, preview fetching, and apply
 * side effects while this pure model keeps numeric parsing and UX copy testable.
 * Flow: parse inputs, validate mode-specific fields, derive preview/apply
 * readiness, then build the preview payload only when the operation is runnable.
 */
export const deriveSliceFormModel = ({
  selectedNodeId,
  selectedNodeLabel,
  nodeRowCount,
  mode,
  offsetInput,
  lengthInput,
  sampleSizeInput,
  randomSeedInput,
  noRandomSeed,
  isSlicing,
  isOperationsLoading,
}: SliceFormModelInput): SliceFormModel => {
  const hasSelection = Boolean(selectedNodeId);

  const trimmedOffset = offsetInput.trim();
  const offsetNumber = Number(trimmedOffset);
  const offsetValid =
    trimmedOffset.length > 0 && Number.isInteger(offsetNumber) && offsetNumber >= 0;

  const trimmedLength = lengthInput.trim();
  const lengthNumber = trimmedLength.length > 0 ? Number(trimmedLength) : null;
  const lengthValid = lengthNumber !== null && Number.isInteger(lengthNumber) && lengthNumber >= 1;
  const lengthValue = lengthNumber ?? undefined;

  const trimmedSampleSize = sampleSizeInput.trim();
  const sampleSizeNumber = trimmedSampleSize.length > 0 ? Number(trimmedSampleSize) : null;
  const sampleSizeValid =
    sampleSizeNumber !== null &&
    Number.isFinite(sampleSizeNumber) &&
    sampleSizeNumber > 0 &&
    (sampleSizeNumber < 1 || Number.isInteger(sampleSizeNumber));
  const sampleSizeValue = sampleSizeValid ? sampleSizeNumber : undefined;

  const sampleSizeHint: string | null = (() => {
    if (trimmedSampleSize.length === 0 || sampleSizeValid) return null;
    if (sampleSizeNumber !== null && sampleSizeNumber >= 1 && !Number.isInteger(sampleSizeNumber)) {
      return 'Values ≥ 1 must be whole numbers (e.g. 25, not 25.5).';
    }
    return 'Enter a fraction (0–1) or an integer row count (≥ 1).';
  })();

  const trimmedRandomSeed = randomSeedInput.trim();
  const randomSeedNumber = trimmedRandomSeed.length > 0 ? Number(trimmedRandomSeed) : null;
  const randomSeedValid = noRandomSeed
    ? true
    : trimmedRandomSeed.length > 0 &&
      randomSeedNumber !== null &&
      Number.isInteger(randomSeedNumber) &&
      randomSeedNumber >= 0;
  const randomSeedValue = noRandomSeed
    ? undefined
    : randomSeedValid
      ? (randomSeedNumber ?? undefined)
      : undefined;

  const hasOperation =
    mode === 'slice' ? offsetValid && lengthValid : sampleSizeValid && randomSeedValid;

  const isFullShuffle =
    mode === 'random_sample' &&
    nodeRowCount !== null &&
    sampleSizeValid &&
    Number.isInteger(sampleSizeNumber) &&
    sampleSizeNumber >= nodeRowCount;

  const formSignature = [
    selectedNodeId ?? '',
    mode,
    offsetInput,
    lengthInput,
    sampleSizeInput,
    randomSeedInput,
    noRandomSeed ? 'no-random-seed' : 'seeded',
  ].join('\0');
  const resultSignature = [selectedNodeId ?? '', selectedNodeLabel, mode].join('\0');

  const autoNodeName = buildSamplingAutoNodeName({
    baseName: selectedNodeLabel || selectedNodeId,
    mode,
    offset: offsetValid ? offsetNumber : undefined,
    length: lengthValid ? lengthValue : undefined,
    sampleSize: sampleSizeValid ? sampleSizeValue : undefined,
    randomSeed: randomSeedValid ? randomSeedValue : undefined,
    noRandomSeed,
    isFullShuffle,
  });

  const rangeSummary = (() => {
    if (!hasSelection) {
      return 'Select a data block to configure sampling.';
    }
    if (mode === 'slice') {
      if (!offsetValid) {
        return 'Offset must be a non-negative integer (zero-based row index).';
      }
      if (!lengthValid) {
        return 'Length is required – enter the number of rows to include in the slice.';
      }
      if (lengthValue === 0) {
        return `Slice starting at row ${String(offsetNumber)} returning zero rows (length = 0).`;
      }
      const endRow = offsetNumber + (lengthValue ?? 0) - 1;
      return `Rows ${String(offsetNumber)}–${String(endRow)} inclusive (${String(lengthValue)} total).`;
    }

    if (!sampleSizeValid) {
      return 'Enter a fraction (0–1) or an integer row count (≥ 1).';
    }
    if (!randomSeedValid) {
      return 'Random seed must be a non-negative integer.';
    }
    if (sampleSizeValue !== undefined && sampleSizeValue < 1) {
      if (randomSeedValue === undefined) {
        return `Random sample using fraction ${String(sampleSizeValue)}.`;
      }
      return `Random sample using fraction ${String(sampleSizeValue)} with seed ${String(randomSeedValue)}.`;
    }
    if (randomSeedValue === undefined) {
      return `Random sample of ${String(sampleSizeValue)} rows.`;
    }
    return `Random sample of ${String(sampleSizeValue)} rows with seed ${String(randomSeedValue)}.`;
  })();

  const previewReady = hasSelection && (mode === 'slice' ? offsetValid : true);

  const operationPayload = hasOperation
    ? buildSlicePayload({
        mode,
        offset: offsetNumber,
        lengthValue,
        sampleSizeValue,
        randomSeedValue,
        isFullShuffle,
      })
    : null;

  const previewReadyMessage = !hasSelection
    ? 'Select a data block to preview output rows.'
    : mode === 'slice'
      ? 'Showing original data. Enter offset and length to preview sliced rows.'
      : 'Showing original data. Enter a fraction or row count and optional seed to preview sampled rows.';

  const applyDisabled = !hasSelection || !hasOperation || isSlicing || isOperationsLoading;

  const applyDisabledReason: string | undefined = (() => {
    if (isSlicing || isOperationsLoading) return undefined;
    if (!hasSelection) return 'Select a data block first';
    if (mode === 'slice') {
      if (!lengthValid) {
        return trimmedLength.length === 0
          ? 'Enter a length (number of rows to include)'
          : 'Length must be a whole number ≥ 1';
      }
    } else {
      if (!sampleSizeValid) {
        return trimmedSampleSize.length === 0
          ? 'Enter a sample size'
          : 'Enter a valid sample size — a fraction (0–1) or a whole number ≥ 1';
      }
      if (!randomSeedValid) return 'Enter a valid random seed (non-negative integer)';
    }
    return undefined;
  })();

  return {
    offsetNumber,
    offsetValid,
    lengthNumber,
    lengthValid,
    lengthValue,
    sampleSizeNumber,
    sampleSizeValid,
    sampleSizeValue,
    sampleSizeHint,
    randomSeedNumber,
    randomSeedValid,
    randomSeedValue,
    hasSelection,
    hasOperation,
    isFullShuffle,
    formSignature,
    resultSignature,
    autoNodeName,
    rangeSummary,
    previewReady,
    previewReadyMessage,
    operationPayload,
    applyDisabled,
    applyDisabledReason,
  };
};
