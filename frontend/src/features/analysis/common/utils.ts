export const DEFAULT_TOKEN_LIMIT = 10;
export const MAX_DISPLAY_TOKEN_LIMIT = 100;
export const SERVER_LIMIT_MULTIPLIER = 5;
export const MAX_SERVER_TOKEN_LIMIT = 5000;

type ClampResult = {
  limit: number;
  wasClamped: boolean;
};

export const clampDisplayTokenLimit = (value: number | null | undefined): ClampResult => {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_TOKEN_LIMIT;
  const normalized = Math.max(1, Math.floor(numeric));
  const bounded = Math.min(normalized, MAX_DISPLAY_TOKEN_LIMIT);
  return {
    limit: bounded,
    wasClamped: bounded !== normalized,
  };
};

export const computeServerLimit = (limit: number | null | undefined): number => {
  const numeric = typeof limit === 'number' && Number.isFinite(limit) ? limit : DEFAULT_TOKEN_LIMIT;
  return Math.min(
    Math.max(Math.floor(numeric) * SERVER_LIMIT_MULTIPLIER, DEFAULT_TOKEN_LIMIT),
    MAX_SERVER_TOKEN_LIMIT
  );
};

export const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  return null;
};

export interface FormatNumberOptions {
  suffix?: string;
  multiplier?: number;
  fallback?: string;
  locale?: string;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}

export const formatNumber = (
  value: unknown,
  decimals = 2,
  options: FormatNumberOptions = {}
): string => {
  const numeric = toFiniteNumber(value);
  if (numeric === null) {
    return options.fallback ?? '—';
  }

  const multiplier = typeof options.multiplier === 'number' ? options.multiplier : 1;
  const scaled = numeric * multiplier;
  const minimumFractionDigits =
    typeof options.minimumFractionDigits === 'number' ? options.minimumFractionDigits : decimals;
  const maximumFractionDigits =
    typeof options.maximumFractionDigits === 'number' ? options.maximumFractionDigits : decimals;

  const formatter = new Intl.NumberFormat(options.locale, {
    minimumFractionDigits,
    maximumFractionDigits,
  });

  const formatted = formatter.format(scaled);
  return options.suffix ? `${formatted}${options.suffix}` : formatted;
};

export const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
