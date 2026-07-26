export interface ConfusionCount {
  reference: string;
  comparison: string;
  count: number;
}

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
