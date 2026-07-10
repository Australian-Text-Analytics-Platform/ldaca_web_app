const DEFAULT_NAME_FALLBACK = 'dataset';
const DEFAULT_SLICE_OFFSET = 0;

/**
 * Sanitizes numeric sample sizes for the generated node-name token.
 * Called by: buildSamplingAutoNodeName when a positive sample size is encoded.
 * Flow: preserve decimal readability, replace unsupported characters, collapse
 * separators, and keep the historical fallback for an empty token.
 */
const formatSampleSizeToken = (sampleSize: number): string => {
  const normalized = String(sampleSize)
    .replace(/\./g, '_')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || 'value';
};

/**
 * Builds a suggested output name for row slicing/sampling workflows.
 * Used by: preprocessing Sample Rows and Topic Modeling sampling so the same
 * slice/random/seed inputs produce the same child-node name across features.
 * Flow: normalize the source label, encode slice bounds or sample size, append
 * deterministic/true-random seed details, and return the readable name.
 */
export const buildSamplingAutoNodeName = ({
  baseName,
  mode,
  offset,
  length,
  sampleSize,
  randomSeed,
  noRandomSeed,
  isFullShuffle,
}: {
  baseName: string | null | undefined;
  mode: 'slice' | 'random_sample';
  offset?: number;
  length?: number;
  sampleSize?: number;
  randomSeed?: number;
  noRandomSeed?: boolean;
  isFullShuffle?: boolean;
}): string => {
  const base = (baseName ?? '').trim() || DEFAULT_NAME_FALLBACK;

  if (mode === 'slice') {
    const start =
      Number.isInteger(offset) && (offset ?? 0) >= 0 ? (offset ?? 0) : DEFAULT_SLICE_OFFSET;

    if (!Number.isInteger(length) || length === undefined) {
      return `${base}_sliced_from_${String(start)}`;
    }

    if (length <= 0) {
      return `${base}_sliced_from_${String(start)}_length_${String(length)}`;
    }

    const end = start + length - 1;
    return `${base}_sliced_from_${String(start)}_to_${String(end)}`;
  }

  const seedToken = noRandomSeed
    ? '_true_random'
    : typeof randomSeed === 'number' && Number.isInteger(randomSeed) && randomSeed >= 0
      ? `_rs_${String(randomSeed)}`
      : '';

  if (isFullShuffle) {
    return `${base}_shuffled${seedToken}`;
  }

  if (typeof sampleSize !== 'number' || !Number.isFinite(sampleSize) || sampleSize <= 0) {
    return `${base}_sampled`;
  }

  const sizeToken = formatSampleSizeToken(sampleSize);
  const sampleToken = sampleSize < 1 ? `fr_${sizeToken}` : `n_${sizeToken}`;

  return `${base}_sampled_${sampleToken}${seedToken}`;
};
