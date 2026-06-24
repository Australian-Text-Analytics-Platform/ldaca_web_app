/** Converts arbitrary backend cell values into editable/displayable text for annotation review cells. */
/**
 * Called by: AiAnnotatorFeature and review model helpers because backend row values can be primitives, nulls, or nested JSON-like objects while table cells and comparisons need stable strings.
 */
export const stringifyAiAnnotationCell = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      // eslint-disable-next-line @typescript-eslint/no-base-to-string -- fallback for objects JSON.stringify cannot serialize (e.g. circular refs)
      return String(value);
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- value is a non-object primitive after the guards above
  return String(value);
};

/** Builds a stable draft/saving map key for one review table cell and annotator provider. */
/**
 * Called by: AiAnnotatorFeature review handlers and tests because draft edits and save flags must key by global row index plus provider name.
 */
export const buildAiAnnotationEditKey = (rowIndex: number, providerName: string) =>
  `${String(rowIndex)}::${providerName}`;

/** Reads the persisted annotation value for a provider from one row payload. */
/**
 * Called by: AiAnnotatorFeature review rendering and save handlers because they need to compare draft values against the backend-saved annotation before auto-saving.
 * Flow: read the annotation array from the row, find the matching provider entry, stringify its annotation, and fall back to an empty string when no saved value exists.
 */
export const getPersistedAiAnnotationValue = (
  row: Record<string, unknown>,
  providerName: string,
  annotationColumn: string,
) => {
  const raw = row[annotationColumn];
  if (!Array.isArray(raw)) {
    return '';
  }
  const found = raw.find((item) => {
    if (!item || typeof item !== 'object') {
      return false;
    }
    return stringifyAiAnnotationCell((item as Record<string, unknown>).provider) === providerName;
  }) as Record<string, unknown> | undefined;
  return found ? stringifyAiAnnotationCell(found.annotation) : '';
};

interface ReviewValueArgs {
  row: Record<string, unknown>;
  providerName: string;
  rowIndex: number;
  annotationColumn: string;
  reviewEdits: Record<string, string>;
}

/** Chooses a draft review value when present, otherwise falling back to persisted data. */
/**
 * Called by: AiAnnotatorFeature review cells because the table must immediately reflect local edits while still displaying saved values for untouched cells.
 */
export const getAiAnnotationReviewValue = ({
  row,
  providerName,
  rowIndex,
  annotationColumn,
  reviewEdits,
}: ReviewValueArgs) => {
  const editKey = buildAiAnnotationEditKey(rowIndex, providerName);
  if (Object.prototype.hasOwnProperty.call(reviewEdits, editKey)) {
    return reviewEdits[editKey] ?? '';
  }
  return getPersistedAiAnnotationValue(row, providerName, annotationColumn);
};

interface ApplyReviewEditArgs {
  rows: Record<string, unknown>[];
  page: number;
  pageSize: number;
  rowIndex: number;
  annotationColumn: string;
  providerName: string;
  annotation: string;
}

/** Applies a saved review edit to the currently loaded page of row data. */
/**
 * Called by: AiAnnotatorFeature after saveAiAnnotation succeeds because the review table should update in place without refetching the page.
 * Flow: convert local row positions to global indices, update only the matching row's annotation provider entry, append missing provider entries, and preserve untouched row object identities.
 */
export const applyAiAnnotationReviewEditToRows = ({
  rows,
  page,
  pageSize,
  rowIndex,
  annotationColumn,
  providerName,
  annotation,
}: ApplyReviewEditArgs) => {
  const pageOffset = (Math.max(page, 1) - 1) * pageSize;

  return rows.map((existingRow, localIndex) => {
    const globalIndex = pageOffset + localIndex;
    if (globalIndex !== rowIndex) {
      return existingRow;
    }

    const raw = existingRow[annotationColumn];
    const existingEntries = Array.isArray(raw)
      ? raw
          .filter(
            (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object',
          )
          .map((item) => ({
            provider: stringifyAiAnnotationCell(item.provider),
            annotation: stringifyAiAnnotationCell(item.annotation),
          }))
      : [];

    let replaced = false;
    const nextEntries = existingEntries.map((entry) => {
      if (entry.provider === providerName) {
        replaced = true;
        return { provider: entry.provider, annotation };
      }
      return entry;
    });

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- `replaced` is mutated inside the map callback; TS control-flow analysis does not track the closure mutation
    if (!replaced) {
      nextEntries.push({ provider: providerName, annotation });
    }

    return {
      ...existingRow,
      [annotationColumn]: nextEntries,
    };
  });
};

/** Collects unique provider names from loaded rows and caller-owned provider lists. */
/**
 * Called by: AiAnnotatorFeature review rendering because the editable table needs one column for each stored, discovered, or manually added provider.
 */
export const deriveAiAnnotationReviewProviders = (
  rows: Record<string, unknown>[],
  annotationColumn: string,
  storedProviders: string[],
  additionalProviders: string[],
) => {
  const discoveredProviders = rows.flatMap((row) => {
    const raw = row[annotationColumn];
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => stringifyAiAnnotationCell(item.provider).trim())
      .filter(Boolean);
  });
  return Array.from(new Set([...storedProviders, ...discoveredProviders, ...additionalProviders]))
    .map((provider) => provider.trim())
    .filter(Boolean);
};

/** Collects unique category values from loaded rows and caller-owned category lists. */
/**
 * Called by: AiAnnotatorFeature review rendering because each category select should include backend-known, page-discovered, and locally added options.
 */
export const deriveAiAnnotationReviewCategories = (
  rows: Record<string, unknown>[],
  annotationColumn: string,
  storedCategories: string[],
  temporaryCategories: string[],
) => {
  const discoveredCategories = rows.flatMap((row) => {
    const raw = row[annotationColumn];
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => stringifyAiAnnotationCell(item.annotation).trim())
      .filter(Boolean);
  });
  return Array.from(new Set([...storedCategories, ...discoveredCategories, ...temporaryCategories]))
    .map((category) => category.trim())
    .filter(Boolean);
};
