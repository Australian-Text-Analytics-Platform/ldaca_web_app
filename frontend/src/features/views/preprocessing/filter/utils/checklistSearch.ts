/**
 * Escapes literal text before it is embedded in a checklist-search RegExp.
 * Used by: local callers in preprocessing/checklistSearch module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 */
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Detects whether a user query contains active glob wildcards. The checklist
 * search treats escaped `*` and `?` as literal characters.
 * Used by: local callers in preprocessing/checklistSearch module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 */
const hasUnescapedWildcard = (query: string): boolean => {
  let escaped = false;
  for (const char of query) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '*' || char === '?') {
      return true;
    }
  }
  return false;
};

/**
 * Converts a small glob query into a case-insensitive whole-label RegExp.
 * Used by: local callers in preprocessing/checklistSearch module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 * Steps: escape regex metacharacters, translate glob wildcards, anchor the expression, and
 * return undefined for invalid user patterns.
 */
const globToRegExp = (query: string): RegExp => {
  let pattern = '^';
  let escaped = false;

  for (const char of query) {
    if (escaped) {
      pattern += escapeRegex(char);
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '*') {
      pattern += '.*';
      continue;
    }

    if (char === '?') {
      pattern += '.';
      continue;
    }

    pattern += escapeRegex(char);
  }

  if (escaped) {
    pattern += '\\\\';
  }

  pattern += '$';
  return new RegExp(pattern, 'i');
};

/**
 * Removes escape markers from literal wildcard searches so substring matching
 * can find labels containing `*`, `?`, or `\\`.
 * Used by: local callers in preprocessing/checklistSearch module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 * Steps: scan escaped characters, keep supported literal wildcards, preserve unknown escapes,
 * and retain trailing backslashes.
 */
const decodeEscapedWildcards = (query: string): string => {
  let result = '';
  let escaped = false;

  for (const char of query) {
    if (escaped) {
      if (char === '*' || char === '?' || char === '\\') {
        result += char;
      } else {
        result += `\\${char}`;
      }
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    result += char;
  }

  if (escaped) {
    result += '\\';
  }

  return result;
};

/**
 * Matches one checklist label against the user's search query. The
 * FilterValueChecklist component uses it for both literal and glob searches.
 * Used by: FilterValueChecklist component, checklistSearch tests, useTopicModelingBubbleChart hook (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 */
export const matchChecklistOption = (optionLabel: string, query: string): boolean => {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return true;
  }

  if (hasUnescapedWildcard(normalizedQuery)) {
    return globToRegExp(normalizedQuery).test(optionLabel);
  }

  return optionLabel.toLowerCase().includes(decodeEscapedWildcards(normalizedQuery).toLowerCase());
};
