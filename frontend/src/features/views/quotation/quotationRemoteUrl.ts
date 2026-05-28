/**
 * Remote-URL normalization for the quotation engine config dialog.
 * Pulled out of QuotationFeature.tsx so the feature component stays
 * focused on rendering and orchestration.
 */

export type NormalizationFailureReason = 'empty' | 'scheme' | 'format' | 'protocol';

export interface NormalizedRemoteUrl {
  normalized: string;
  valid: boolean;
  reason: NormalizationFailureReason | null;
}

const NORMALIZED_SCHEME_REGEX = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

/**
 * Accept user-entered URLs that may omit the scheme; reject anything that
 * isn't an http(s) endpoint. Returns the normalized URL plus a structured
 * reason on failure so the UI can show a specific error message.
 * Used by: QuotationFeature remote-engine controls because user-entered service URLs may omit schemes but must resolve to http(s) before task submission.
 * Flow: normalize inputs, apply the analysis-specific branch, then return the derived value consumed by the caller.
 */
export const normalizeRemoteUrl = (value: string): NormalizedRemoteUrl => {
  const trimmed = value.trim();
  if (!trimmed.length) {
    return { normalized: '', valid: false, reason: 'empty' };
  }

  const hasScheme = NORMALIZED_SCHEME_REGEX.test(trimmed);
  const isHttpScheme = /^https?:\/\//i.test(trimmed);

  // Reuses URL parsing to validate candidate endpoints after optional scheme insertion.
  // Called by: normalizeRemoteUrl for raw and scheme-prefixed URL candidates because the caller needs this analysis-specific step before continuing its request, result, display, or cleanup workflow.
  const canParse = (candidate: string) => {
    try {
      const parsed = new URL(candidate);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  };

  if (canParse(trimmed)) {
    return { normalized: trimmed, valid: true, reason: null };
  }

  if (!hasScheme) {
    const prefixed = `http://${trimmed}`;
    if (canParse(prefixed)) {
      return { normalized: prefixed, valid: true, reason: null };
    }
    return { normalized: trimmed, valid: false, reason: 'format' };
  }

  if (!isHttpScheme) {
    return { normalized: trimmed, valid: false, reason: 'protocol' };
  }

  return { normalized: trimmed, valid: false, reason: 'format' };
};
