export const DEFAULT_TOKEN_LIMIT = 10;

type ClampResult = {
  limit: number;
  wasClamped: boolean;
};

export const clampDisplayTokenLimit = (value: number | null | undefined): ClampResult => {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_TOKEN_LIMIT;
  const floored = Math.floor(numeric);
  const bounded = Math.max(1, Number.isFinite(floored) ? floored : DEFAULT_TOKEN_LIMIT);
  return {
    limit: bounded,
    wasClamped: bounded !== floored,
  };
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
