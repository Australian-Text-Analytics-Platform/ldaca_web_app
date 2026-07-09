// Heuristic datetime format inference for Python strftime tokens.
// Tries to detect common patterns (date, time, fractional seconds, timezone).
// Returns null if not confident enough (e.g., missing year).

/**
 * Used by: src/components/panels/DatetimeFormatPanel.tsx, src/utils/__tests__/datetimeFormatInfer.test.ts.
 * Flow: validate inputs, normalize values, branch on runtime conditions, then return the shared result.
 */
export function inferDatetimeFormat(
  samples: string[],
  opts: { requireTime?: boolean } = {},
): string | null {
  const nonEmpty = samples.filter((s) => typeof s === 'string' && s.trim()).slice(0, 50);
  if (!nonEmpty.length) return null;

  // Choose the sample with the most content (likely has time / tz info)
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- nonEmpty is guaranteed non-empty by the length guard above
  const candidate = nonEmpty.toSorted((a, b) => b.length - a.length)[0]!.trim();

  let format = candidate;

  // Year (4-digit)
  format = format.replace(/\b\d{4}\b/, '%Y');

  // Full month names (January, February, ...) → %B
  format = format.replace(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/i,
    '%B',
  );
  // Abbreviated month names (Jan, Feb, ...) → %b
  if (!format.includes('%B')) {
    format = format.replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i, '%b');
  }

  /** Tells later replacements whether the candidate already exposes a month token. */
  /** Called by: inferDatetimeFormat in this utility module. */
  const hasMonthToken = () =>
    format.includes('%m') || format.includes('%b') || format.includes('%B');
  /** Escapes regex-significant date separators before dynamic replacement rules consume them. */
  /** Called by: inferDatetimeFormat in this utility module. */
  const escapeSep = (s: string) => (s === '.' ? '\\.' : s);

  // Month and day: attempt to respect separators - replace first 2-digit group after %Y separator with %m then next with %d
  const dateSepMatch = /%Y([-/.])/.exec(format);
  if (dateSepMatch) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- capture group 1 is guaranteed present when the regex matches
    const sep = dateSepMatch[1]!;
    const esc = escapeSep(sep);
    if (!hasMonthToken()) {
      format = format.replace(new RegExp(`%Y${esc}(\\d{2})`), `%Y${sep}%m`);
    }
    if (!format.includes('%d')) {
      format = format.replace(new RegExp(`(?:%m|%b|%B)${esc}(\\d{2})`), (match) =>
        match.replace(/\d{2}/, '%d'),
      );
    }
  }
  // General fallback for remaining date components
  if (!hasMonthToken()) format = format.replace(/\b\d{2}\b/, '%m');
  if (!format.includes('%d')) format = format.replace(/\b\d{2}\b/, '%d');

  // Timezone offset MUST be detected BEFORE time patterns to avoid
  // +00:00 being misinterpreted as a second %H:%M.
  // With colon: +00:00, -05:30 → %:z (chrono/Polars specifier)
  format = format.replace(/ ?[+-]\d{2}:\d{2}\s*$/, '%:z');
  // Without colon: +0000, -0530 → %z
  format = format.replace(/ ?[+-]\d{4}\b/, ' %z');
  // Trailing Z for UTC
  format = format.replace(/Z$/, 'Z');

  // Time HH:MM:SS — also match after 'T' for ISO 8601
  format = format.replace(/(?:\b|(?<=T))([01]\d|2[0-3]):[0-5]\d:[0-5]\d/, '%H:%M:%S');
  // Time HH:MM (only if full not already replaced) — use negative lookahead instead of \b to handle trailing Z
  format = format.replace(/(?:\b|(?<=T))([01]\d|2[0-3]):[0-5]\d(?![:\d])/, '%H:%M');

  // 12-hour AM/PM → convert %H to %I and add %p
  format = format.replace(/%H(:%M(?::%S)?)\s*(?:AM|PM)/i, '%I$1 %p');

  // Fractional seconds .123 or .123456 -> replace any dot + 3-6 digits with %.f (Chrono-style subseconds placeholder)
  format = format.replace(/\.\d{3,6}/, '%.f');

  // Basic validation
  if (!format.includes('%Y')) return null;
  if (opts.requireTime && !format.includes('%H') && !format.includes('%I')) return null;

  return format;
}
