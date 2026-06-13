export const ISO_PLACEHOLDER = 'YYYY-MM-DDTHH:MM:SS+00:00';

/**
 * Normalizes partial ISO drafts before datetime filters send values to APIs.
 * Used by: dateTimeUtils utilities (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 * Steps: trim input, expand date/time-only forms, append UTC offsets, and normalize Z suffixes.
 */
export const normalizeIsoDraft = (txt: string): string => {
  let s = txt.trim();
  if (!s) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00+00:00';
  if (/T\d{2}:\d{2}(\+00:00)?$/.test(s))
    s = s.replace(
      /T(\d{2}:\d{2})(\+00:00)?$/,
      (_m: string, hm: string, tz: string | undefined) => `T${hm}:00${tz ?? '+00:00'}`,
    );
  if (/T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) s += '+00:00';
  s = s.replace(/Z$/, '+00:00');
  return s;
};

/**
 * Parses ISO filter values into local Date objects for calendar controls.
 * Used by: dateTimeUtils utilities (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 * Steps: normalize partial ISO text, parse a Date, preserve local calendar fields when present,
 * and return null for invalid values.
 */
export const parseIsoToLocalDate = (input: string): Date | null => {
  if (!input) return null;
  let candidate = input.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    candidate += 'T00:00:00+00:00';
  }
  if (/T\d{2}:\d{2}(Z|[+-]\d{2}:?\d{2})?$/.test(candidate)) {
    candidate = candidate.replace(
      /T(\d{2}:\d{2})(Z|[+-]\d{2}:?\d{2})?$/,
      (_m: string, hm: string, tz: string | undefined) => `T${hm}:00${tz ?? '+00:00'}`,
    );
  }
  if (/T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(candidate)) {
    candidate += '+00:00';
  }
  candidate = candidate.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const d = new Date(candidate);
  if (isNaN(d.getTime())) return null;
  try {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(candidate);
    if (m) {
      const [, Y, M, D, H, Min, S] = m;
      return new Date(Number(Y), Number(M) - 1, Number(D), Number(H), Number(Min), Number(S));
    }
  } catch {
    // ignore
  }
  return d;
};

/**
 * Pads date/time segments for ISO and time input strings.
 * Used by: local callers in preprocessing/dateTimeHelpers module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 */
const padNumber = (value: number): string => value.toString().padStart(2, '0');

/**
 * Converts calendar selections into the UTC-style string backend filters expect.
 * Used by: dateTimeUtils utilities (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 */
export const toIsoUtcString = (date: Date): string => {
  return `${String(date.getFullYear())}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}T${padNumber(date.getHours())}:${padNumber(date.getMinutes())}:${padNumber(date.getSeconds())}+00:00`;
};

/**
 * Formats a parsed Date for the time input inside DateTimePickerField.
 * Used by: dateTimeUtils utilities (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 */
export const formatTimeInputValue = (date: Date | null | undefined): string => {
  if (!date) {
    return '00:00:00';
  }
  return `${padNumber(date.getHours())}:${padNumber(date.getMinutes())}:${padNumber(date.getSeconds())}`;
};

/**
 * Splits a time input value into numeric segments for date recombination.
 * Used by: local callers in preprocessing/dateTimeHelpers module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 * Flow: split HH:MM:SS parts, parse each segment, and replace invalid numbers with zero before recombination.
 */
const parseTimeSegments = (value: string): [number, number, number] => {
  const [hours = '0', minutes = '0', seconds = '0'] = value.split(':');
  const parsedHours = Number(hours);
  const parsedMinutes = Number(minutes);
  const parsedSeconds = Number(seconds);
  return [
    Number.isFinite(parsedHours) ? parsedHours : 0,
    Number.isFinite(parsedMinutes) ? parsedMinutes : 0,
    Number.isFinite(parsedSeconds) ? parsedSeconds : 0,
  ];
};

/**
 * Combines calendar date and time input values for datetime filter editing.
 * Used by: dateTimeUtils utilities (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 */
export const combineDateAndTime = (date: Date, timeValue: string): Date => {
  const [hours, minutes, seconds] = parseTimeSegments(timeValue);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes, seconds, 0);
};

/**
 * Clamps user-entered time values into the valid HH:MM:SS range.
 * Used by: dateTimeUtils utilities (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 */
export const normalizeTimeValue = (value: string): string => {
  const [hours, minutes, seconds] = parseTimeSegments(value);
  return `${padNumber(Math.max(0, Math.min(23, hours)))}:${padNumber(Math.max(0, Math.min(59, minutes)))}:${padNumber(Math.max(0, Math.min(59, seconds)))}`;
};
