/**
 * Case-insensitive filtering for long option lists, used by the searchable
 * select primitive so column pickers stay usable on wide tables.
 *
 * A query containing `*` or `?` is read as an anchored glob — `*` matches any
 * run of characters, `?` exactly one — so `spk_*` finds every speaker column
 * and `*_id` every identifier column. Any other query matches as a plain
 * substring, which keeps the common case (type a few letters) unsurprising.
 */

const WILDCARD_RE = /[*?]/;
const REGEXP_METACHARACTERS_RE = /[.*+?^${}()|[\]\\]/g;

/** Escapes regular-expression metacharacters so column names match literally. */
function escapeRegExp(value: string): string {
  return value.replace(REGEXP_METACHARACTERS_RE, '\\$&');
}

/**
 * Builds a predicate for `query`, or null when the query is blank so callers
 * can skip filtering instead of testing every candidate against a match-all.
 */
export function createWildcardMatcher(query: string): ((candidate: string) => boolean) | null {
  const trimmed = query.trim();
  if (!trimmed) return null;

  if (WILDCARD_RE.test(trimmed)) {
    const pattern = escapeRegExp(trimmed).replace(/\\\*/g, '.*').replace(/\\\?/g, '.');
    const globRe = new RegExp(`^${pattern}$`, 'i');
    return (candidate) => globRe.test(candidate);
  }

  const needle = trimmed.toLowerCase();
  return (candidate) => candidate.toLowerCase().includes(needle);
}

/** Filters `values` by `query`, preserving the caller's original ordering. */
export function filterByWildcard(values: string[], query: string): string[] {
  const matches = createWildcardMatcher(query);
  return matches ? values.filter(matches) : values;
}
