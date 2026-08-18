/**
 * Escapes literal text before it is embedded in a checklist-search RegExp.
 * Called by: globToRegExp for every non-wildcard query character.
 */
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Detects active glob wildcards while treating escaped `*` and `?` literally.
 * Called by: matchChecklistOption to choose glob or literal matching.
 * Flow: scan left to right, consume escaped characters, and stop at the first
 * unescaped wildcard.
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
 * Called by: matchChecklistOption after it detects an active wildcard.
 * Flow: anchor the pattern, preserve escaped literals, translate `*`/`?`, and
 * retain a trailing backslash as a literal before compiling.
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
 * Decodes escaped wildcard characters before literal substring matching.
 * Called by: matchChecklistOption when no active wildcard is present.
 * Flow: unescape wildcard/backslash literals, preserve unknown escape pairs,
 * and retain a trailing backslash for the final substring comparison.
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
 * Matches a label with the shared literal/glob query language used by Filter
 * checklists and Topic Modeling topic search.
 * Used by: FilterValueChecklist and Topic Modelling graph/list search so
 * cross-feature search semantics stay aligned.
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
