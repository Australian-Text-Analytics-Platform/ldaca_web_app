import { afterEach, describe, expect, it, vi } from 'vitest';
import { TOOL_COMPATIBILITY, isCompatibleSnapshot, parseMajorMinor } from '../compat';
import type { SnapshotToolKey } from '../types';

describe('parseMajorMinor', () => {
  it('accepts "0.4.4"', () => {
    expect(parseMajorMinor('0.4.4')).toBe('0.4');
  });

  it('accepts "v0.4.4"', () => {
    expect(parseMajorMinor('v0.4.4')).toBe('0.4');
  });

  it('accepts "0.4" (no patch)', () => {
    expect(parseMajorMinor('0.4')).toBe('0.4');
  });

  it('accepts pre-release suffixes', () => {
    expect(parseMajorMinor('0.4.0-rc1')).toBe('0.4');
    expect(parseMajorMinor('v1.0.0+build.42')).toBe('1.0');
  });

  it('returns null on malformed input', () => {
    expect(parseMajorMinor('not-a-version')).toBeNull();
    expect(parseMajorMinor('')).toBeNull();
    expect(parseMajorMinor(null)).toBeNull();
    expect(parseMajorMinor(undefined)).toBeNull();
  });
});

describe('isCompatibleSnapshot — default predicate (MAJOR.MINOR match)', () => {
  it('same MAJOR.MINOR is compatible', () => {
    expect(isCompatibleSnapshot('v0.4.2', 'concordance', 'v0.4.4')).toBe(true);
  });

  it('different MAJOR is incompatible', () => {
    expect(isCompatibleSnapshot('v1.0.0', 'concordance', 'v0.4.4')).toBe(false);
  });

  it('different MINOR is incompatible', () => {
    expect(isCompatibleSnapshot('v0.3.5', 'concordance', 'v0.4.4')).toBe(false);
    expect(isCompatibleSnapshot('v0.5.0', 'concordance', 'v0.4.4')).toBe(false);
  });

  it('malformed snapshot version is incompatible', () => {
    expect(isCompatibleSnapshot('garbage', 'concordance', 'v0.4.4')).toBe(false);
  });

  it('empty current version is treated as unknown — incompatible', () => {
    expect(isCompatibleSnapshot('v0.4.4', 'concordance', '')).toBe(false);
  });
});

describe('isCompatibleSnapshot — per-tool override registry', () => {
  const TOOL: SnapshotToolKey = 'concordance';

  afterEach(() => {
    Reflect.deleteProperty(TOOL_COMPATIBILITY, TOOL);
  });

  it('honours an override allowlist for the named tool', () => {
    TOOL_COMPATIBILITY[TOOL] = { compatibleMinorVersions: ['0.4', '0.5'] };
    expect(isCompatibleSnapshot('v0.4.2', TOOL, 'v0.5.0')).toBe(true);
    expect(isCompatibleSnapshot('v0.5.7', TOOL, 'v0.5.0')).toBe(true);
    // Default same-MAJOR.MINOR rule would have rejected 0.3 against 0.5 too;
    // the override doesn't accidentally widen that.
    expect(isCompatibleSnapshot('v0.3.5', TOOL, 'v0.5.0')).toBe(false);
  });

  it('an override for one tool does NOT affect another tool', () => {
    TOOL_COMPATIBILITY[TOOL] = { compatibleMinorVersions: ['0.4', '0.5'] };
    // quotation has no override — falls back to default.
    expect(isCompatibleSnapshot('v0.4.2', 'quotation', 'v0.5.0')).toBe(false);
    expect(isCompatibleSnapshot('v0.5.0', 'quotation', 'v0.5.0')).toBe(true);
  });

  it('override on an unsupported version still rejects', () => {
    TOOL_COMPATIBILITY[TOOL] = { compatibleMinorVersions: ['0.4'] };
    expect(isCompatibleSnapshot('v0.5.0', TOOL, 'v0.5.0')).toBe(false);
  });
});

describe('getCurrentAppVersion', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns VITE_APP_VERSION when defined', async () => {
    vi.stubEnv('VITE_APP_VERSION', 'v0.4.4');
    const { getCurrentAppVersion } = await import('../compat');
    expect(getCurrentAppVersion()).toBe('v0.4.4');
  });

  it('returns empty string when undefined', async () => {
    vi.stubEnv('VITE_APP_VERSION', '');
    const { getCurrentAppVersion } = await import('../compat');
    expect(getCurrentAppVersion()).toBe('');
  });
});
