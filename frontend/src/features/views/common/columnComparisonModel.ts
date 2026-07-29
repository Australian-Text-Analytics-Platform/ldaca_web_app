export interface ConfusionCount {
  reference: string;
  comparison: string;
  count: number;
}

export const INTERCODER_RELIABILITY_METRICS = [
  { value: 'percent_agreement', label: 'Percent Agreement', symbol: '%' },
  { value: 'cohens_kappa', label: 'Cohen’s Kappa', symbol: 'κ' },
  { value: 'krippendorffs_alpha', label: 'Krippendorff’s Alpha', symbol: 'α' },
] as const;

export type IntercoderReliabilityMetric = (typeof INTERCODER_RELIABILITY_METRICS)[number]['value'];

export const DEFAULT_INTERCODER_RELIABILITY_METRIC: IntercoderReliabilityMetric = 'cohens_kappa';

export const isIntercoderReliabilityMetric = (
  value: string,
): value is IntercoderReliabilityMetric =>
  INTERCODER_RELIABILITY_METRICS.some((metric) => metric.value === value);

interface ReferenceComparisonEdit {
  previousReference: string | null;
  nextReference: string | null;
  comparison: string | null;
}

interface ComparisonValueEdit {
  reference: string | null;
  previousComparison: string | null;
  nextComparison: string | null;
}

/** Applies one persisted reference-cell edit to an aggregate confusion matrix. */
export const applyReferenceComparisonEdit = (
  rows: ConfusionCount[],
  { previousReference, nextReference, comparison }: ReferenceComparisonEdit,
): ConfusionCount[] => {
  if (comparison === null || previousReference === nextReference) return rows;

  const counts = new Map<string, ConfusionCount>(
    rows.map((row) => [JSON.stringify([row.reference, row.comparison]), { ...row }] as const),
  );
  const adjust = (reference: string, delta: number) => {
    const key = JSON.stringify([reference, comparison]);
    const current = counts.get(key);
    const count = (current?.count ?? 0) + delta;
    if (count <= 0) counts.delete(key);
    else counts.set(key, { reference, comparison, count });
  };

  if (previousReference !== null) adjust(previousReference, -1);
  if (nextReference !== null) adjust(nextReference, 1);

  return Array.from(counts.values()).sort(
    (left, right) =>
      left.reference.localeCompare(right.reference) ||
      left.comparison.localeCompare(right.comparison),
  );
};

/** Applies one persisted comparison-cell edit to an aggregate confusion matrix. */
export const applyComparisonValueEdit = (
  rows: ConfusionCount[],
  { reference, previousComparison, nextComparison }: ComparisonValueEdit,
): ConfusionCount[] => {
  if (reference === null || previousComparison === nextComparison) return rows;

  const counts = new Map<string, ConfusionCount>(
    rows.map((row) => [JSON.stringify([row.reference, row.comparison]), { ...row }] as const),
  );
  const adjust = (comparison: string, delta: number) => {
    const key = JSON.stringify([reference, comparison]);
    const current = counts.get(key);
    const count = (current?.count ?? 0) + delta;
    if (count <= 0) counts.delete(key);
    else counts.set(key, { reference, comparison, count });
  };

  if (previousComparison !== null) adjust(previousComparison, -1);
  if (nextComparison !== null) adjust(nextComparison, 1);

  return Array.from(counts.values()).sort(
    (left, right) =>
      left.reference.localeCompare(right.reference) ||
      left.comparison.localeCompare(right.comparison),
  );
};

/** Calculates chance-corrected agreement from confusion-matrix counts. */
export const calculateCohensKappa = (rows: ConfusionCount[]): number | null => {
  const referenceTotals = new Map<string, number>();
  const comparisonTotals = new Map<string, number>();
  let total = 0;
  let agreements = 0;

  rows.forEach((row) => {
    total += row.count;
    referenceTotals.set(row.reference, (referenceTotals.get(row.reference) ?? 0) + row.count);
    comparisonTotals.set(row.comparison, (comparisonTotals.get(row.comparison) ?? 0) + row.count);
    if (row.reference === row.comparison) agreements += row.count;
  });

  if (total === 0) return null;
  const labels = new Set([...referenceTotals.keys(), ...comparisonTotals.keys()]);
  const observedAgreement = agreements / total;
  const expectedAgreement =
    Array.from(labels).reduce(
      (sum, label) => sum + (referenceTotals.get(label) ?? 0) * (comparisonTotals.get(label) ?? 0),
      0,
    ) /
    total ** 2;
  if (expectedAgreement === 1) return null;
  return (observedAgreement - expectedAgreement) / (1 - expectedAgreement);
};

/** Calculates the observed share of exact label matches. */
export const calculatePercentAgreement = (rows: ConfusionCount[]): number | null => {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  if (total === 0) return null;
  const agreements = rows.reduce(
    (sum, row) => sum + (row.reference === row.comparison ? row.count : 0),
    0,
  );
  return agreements / total;
};

/** Calculates nominal Krippendorff’s Alpha for two annotation columns. */
export const calculateKrippendorffsAlpha = (rows: ConfusionCount[]): number | null => {
  const categoryTotals = new Map<string, number>();
  let pairCount = 0;
  let disagreements = 0;

  rows.forEach((row) => {
    pairCount += row.count;
    categoryTotals.set(row.reference, (categoryTotals.get(row.reference) ?? 0) + row.count);
    categoryTotals.set(row.comparison, (categoryTotals.get(row.comparison) ?? 0) + row.count);
    if (row.reference !== row.comparison) disagreements += row.count;
  });

  const valueCount = pairCount * 2;
  if (pairCount === 0 || valueCount < 2) return null;
  const observedDisagreement = disagreements / pairCount;
  const expectedDisagreement =
    (valueCount ** 2 -
      Array.from(categoryTotals.values()).reduce((sum, count) => sum + count ** 2, 0)) /
    (valueCount * (valueCount - 1));
  if (expectedDisagreement === 0) return null;
  return 1 - observedDisagreement / expectedDisagreement;
};

export const calculateIntercoderReliability = (
  rows: ConfusionCount[],
  metric: IntercoderReliabilityMetric,
): number | null => {
  if (metric === 'percent_agreement') return calculatePercentAgreement(rows);
  if (metric === 'krippendorffs_alpha') return calculateKrippendorffsAlpha(rows);
  return calculateCohensKappa(rows);
};

export const formatIntercoderReliability = (
  value: number,
  metric: IntercoderReliabilityMetric,
): string =>
  metric === 'percent_agreement'
    ? `${(value * 100).toFixed(1)}%`
    : `${INTERCODER_RELIABILITY_METRICS.find((option) => option.value === metric)?.symbol ?? ''} ${value.toFixed(3)}`;
