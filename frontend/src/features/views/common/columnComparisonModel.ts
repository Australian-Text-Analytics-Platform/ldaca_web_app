export interface ConfusionCount {
  reference: string;
  comparison: string;
  count: number;
}

interface ReferenceComparisonEdit {
  previousReference: string | null;
  nextReference: string | null;
  comparison: string | null;
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
