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
    // %H and %M should each appear exactly once
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
});
