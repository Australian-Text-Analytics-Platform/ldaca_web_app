// Heuristic datetime format inference for Python strftime tokens.
// Tries to detect common patterns (date, time, fractional seconds, timezone).
// Returns null if not confident enough (e.g., missing year).

export function inferDatetimeFormat(samples: string[], opts: { requireTime?: boolean } = {}): string | null {
  const nonEmpty = samples.filter(s => typeof s === 'string' && s.trim()).slice(0, 50);
  if (!nonEmpty.length) return null;

  // Choose the sample with the most content (likely has time / tz info)
  const candidate = [...nonEmpty].sort((a, b) => b.length - a.length)[0].trim();

  let format = candidate;

  // Year (4-digit)
  format = format.replace(/\b\d{4}\b/, '%Y');
  // Month and day: attempt to respect separators - replace first 2-digit group after %Y separator with %m then next with %d
  const dateSepMatch = format.match(/%Y([-/.])/);
  if (dateSepMatch) {
    const sep = dateSepMatch[1];
    const afterYearRegex = new RegExp(`%Y${sep}(\\d{2})`);
    format = format.replace(afterYearRegex, `%Y${sep}%m`);
    const afterMonthRegex = new RegExp(`%m${sep}(\\d{2})`);
    format = format.replace(afterMonthRegex, `%m${sep}%d`);
  } else {
    // Fallback: replace first 2-digit with %m second with %d if not already present
    if (!format.includes('%m')) format = format.replace(/\b\d{2}\b/, '%m');
    if (!format.includes('%d')) format = format.replace(/\b\d{2}\b/, '%d');
  }

  // Timezone offset MUST be detected BEFORE time patterns to avoid
  // +00:00 being misinterpreted as a second %H:%M.
  // With colon: +00:00, -05:30 → %:z (chrono/Polars specifier)
  format = format.replace(/ ?[+-]\d{2}:\d{2}\s*$/, '%:z');
  // Without colon: +0000, -0530 → %z
  format = format.replace(/ ?[+-]\d{4}\b/, ' %z');
  // Trailing Z for UTC
  format = format.replace(/Z$/, 'Z');

  // Time HH:MM:SS
  format = format.replace(/\b([01]\d|2[0-3]):[0-5]\d:[0-5]\d/, '%H:%M:%S');
  // Time HH:MM (only if full not already replaced)
  format = format.replace(/\b([01]\d|2[0-3]):[0-5]\d\b/, '%H:%M');

  // Fractional seconds .123 or .123456 -> replace any dot + 3-6 digits with %.f (Chrono-style subseconds placeholder)
  format = format.replace(/\.\d{3,6}/, '%.f');

  // Basic validation
  if (!format.includes('%Y')) return null;
  if (opts.requireTime && !format.includes('%H')) return null;

  return format;
}
