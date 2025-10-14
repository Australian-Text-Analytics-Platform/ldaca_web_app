export const ISO_PLACEHOLDER = 'YYYY-MM-DDTHH:MM:SS+00:00';

/**
 * Normalize incomplete ISO date string
 */
export const normalizeIsoDraft = (txt: string): string => {
  let s = txt.trim();
  if (!s) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00+00:00';
  if (/T\d{2}:\d{2}(\+00:00)?$/.test(s)) s = s.replace(/T(\d{2}:\d{2})(\+00:00)?$/, (m, hm, tz) => `T${hm}:00${tz || '+00:00'}`);
  if (/T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) s += '+00:00';
  s = s.replace(/Z$/, '+00:00');
  return s;
};

/**
 * Parse ISO string to local Date object
 */
export const parseIsoToLocalDate = (input: string): Date | null => {
  if (!input) return null;
  let candidate = input.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    candidate += 'T00:00:00+00:00';
  }
  if (/T\d{2}:\d{2}(Z|[+-]\d{2}:?\d{2})?$/.test(candidate)) {
    candidate = candidate.replace(/T(\d{2}:\d{2})(Z|[+-]\d{2}:?\d{2})?$/, (m, hm, tz) => `T${hm}:00${tz || '+00:00'}`);
  }
  if (/T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(candidate)) {
    candidate += '+00:00';
  }
  candidate = candidate.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const d = new Date(candidate);
  if (isNaN(d.getTime())) return null;
  try {
    const m = candidate.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
    if (m) {
      const [, Y, M, D, H, Min, S] = m;
      return new Date(Number(Y), Number(M) - 1, Number(D), Number(H), Number(Min), Number(S));
    }
  } catch { /* ignore */ }
  return d;
};

const padNumber = (value: number): string => value.toString().padStart(2, '0');

/**
 * Convert Date to ISO UTC string
 */
export const toIsoUtcString = (date: Date): string => {
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}T${padNumber(date.getHours())}:${padNumber(date.getMinutes())}:${padNumber(date.getSeconds())}+00:00`;
};

/**
 * Format time input value from Date
 */
export const formatTimeInputValue = (date: Date | null | undefined): string => {
  if (!date) {
    return '00:00:00';
  }
  return `${padNumber(date.getHours())}:${padNumber(date.getMinutes())}:${padNumber(date.getSeconds())}`;
};

/**
 * Parse time string into segments
 */
export const parseTimeSegments = (value: string): [number, number, number] => {
  const [hours = '0', minutes = '0', seconds = '0'] = value.split(':');
  const parsedHours = Number(hours);
  const parsedMinutes = Number(minutes);
  const parsedSeconds = Number(seconds);
  return [Number.isFinite(parsedHours) ? parsedHours : 0, Number.isFinite(parsedMinutes) ? parsedMinutes : 0, Number.isFinite(parsedSeconds) ? parsedSeconds : 0];
};

/**
 * Combine date and time values
 */
export const combineDateAndTime = (date: Date, timeValue: string): Date => {
  const [hours, minutes, seconds] = parseTimeSegments(timeValue);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes, seconds, 0);
};

/**
 * Normalize time value string
 */
export const normalizeTimeValue = (value: string): string => {
  const [hours, minutes, seconds] = parseTimeSegments(value);
  return `${padNumber(Math.max(0, Math.min(23, hours)))}:${padNumber(Math.max(0, Math.min(59, minutes)))}:${padNumber(Math.max(0, Math.min(59, seconds)))}`;
};
