const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
