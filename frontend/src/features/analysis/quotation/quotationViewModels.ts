import type { QuotationGroupedRow, QuotationHitRow } from '@/api/text';

export function flattenQuotationGroups(groups: QuotationGroupedRow[]): QuotationHitRow[] {
  return groups.flatMap((group) => group);
}