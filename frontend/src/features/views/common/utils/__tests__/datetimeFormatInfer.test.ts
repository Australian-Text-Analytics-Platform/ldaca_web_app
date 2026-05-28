import { describe, it, expect } from 'vitest';
import { inferDatetimeFormat } from '../datetimeFormatInfer';

describe('inferDatetimeFormat', () => {
  it('handles timezone offset with colon (+00:00)', () => {
    const samples = ['2020-10-16 15:20:22.000000+00:00'];
    const result = inferDatetimeFormat(samples);
    expect(result).toBe('%Y-%m-%d %H:%M:%S%.f%:z');
  });

  it('handles timezone offset without colon (+0000)', () => {
    const samples = ['2020-10-16 15:20:22.000000+0000'];
    const result = inferDatetimeFormat(samples);
    expect(result).toBe('%Y-%m-%d %H:%M:%S%.f %z');
  });

  it('handles negative timezone offset with colon (-05:30)', () => {
    const samples = ['2020-10-16 15:20:22.000000-05:30'];
    const result = inferDatetimeFormat(samples);
    expect(result).toBe('%Y-%m-%d %H:%M:%S%.f%:z');
  });

  it('handles no timezone offset', () => {
    const samples = ['2020-10-16 15:20:22.000000'];
    const result = inferDatetimeFormat(samples);
    expect(result).toBe('%Y-%m-%d %H:%M:%S%.f');
  });

  it('handles trailing Z with space-separated time', () => {
    const samples = ['2020-10-16 15:20:22Z'];
    const result = inferDatetimeFormat(samples);
    expect(result).toBe('%Y-%m-%d %H:%M:%SZ');
  });

  it('does not produce duplicate %H or %M', () => {
    const samples = ['2020-10-16 15:20:22.000000+00:00'];
    const result = inferDatetimeFormat(samples);
    expect(result!.match(/%H/g)?.length).toBe(1);
    expect(result!.match(/%M/g)?.length).toBe(1);
  });

  it('returns null when no year is found', () => {
    const result = inferDatetimeFormat(['no date here']);
    expect(result).toBeNull();
  });

  it('handles date-only format', () => {
    const result = inferDatetimeFormat(['2020-10-16']);
    expect(result).toBe('%Y-%m-%d');
  });

  // ISO 8601 with T separator
  it('handles ISO 8601 with T separator', () => {
    expect(inferDatetimeFormat(['2020-10-16T15:20:22'])).toBe('%Y-%m-%dT%H:%M:%S');
  });

  it('handles ISO 8601 T with fractional seconds and tz', () => {
    expect(inferDatetimeFormat(['2020-10-16T15:20:22.123456+00:00'])).toBe(
      '%Y-%m-%dT%H:%M:%S%.f%:z',
    );
  });

  it('handles ISO 8601 T with trailing Z', () => {
    expect(inferDatetimeFormat(['2020-10-16T15:20:22Z'])).toBe('%Y-%m-%dT%H:%M:%SZ');
  });

  it('handles ISO 8601 T with HH:MM only', () => {
    expect(inferDatetimeFormat(['2020-10-16T15:20'])).toBe('%Y-%m-%dT%H:%M');
  });

  // Abbreviated month names
  it('handles abbreviated month name (DD Mon YYYY)', () => {
    expect(inferDatetimeFormat(['16 Oct 2020'])).toBe('%d %b %Y');
  });

  it('handles abbreviated month name (Mon DD, YYYY)', () => {
    expect(inferDatetimeFormat(['Oct 16, 2020'])).toBe('%b %d, %Y');
  });

  it('handles abbreviated month name with separator (YYYY-Mon-DD)', () => {
    expect(inferDatetimeFormat(['2020-Oct-16'])).toBe('%Y-%b-%d');
  });

  // Full month names
  it('handles full month name', () => {
    expect(inferDatetimeFormat(['October 16, 2020'])).toBe('%B %d, %Y');
  });

  // 12-hour AM/PM
  it('handles 12-hour time with AM/PM', () => {
    expect(inferDatetimeFormat(['2020-10-16 03:20:22 PM'])).toBe('%Y-%m-%d %I:%M:%S %p');
  });

  it('handles 12-hour time without seconds with AM/PM', () => {
    expect(inferDatetimeFormat(['2020-10-16 03:20 AM'])).toBe('%Y-%m-%d %I:%M %p');
  });

  // Slash-separated dates
  it('handles slash-separated date (YYYY/MM/DD)', () => {
    expect(inferDatetimeFormat(['2020/10/16'])).toBe('%Y/%m/%d');
  });

  it('handles slash-separated date with year at end', () => {
    expect(inferDatetimeFormat(['10/16/2020'])).toBe('%m/%d/%Y');
  });

  // Dot-separated dates
  it('handles dot-separated date', () => {
    expect(inferDatetimeFormat(['2020.10.16'])).toBe('%Y.%m.%d');
  });
});
