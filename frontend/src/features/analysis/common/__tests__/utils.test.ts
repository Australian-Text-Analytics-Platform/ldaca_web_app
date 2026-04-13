import { describe, expect, it } from 'vitest';

import { clampDisplayTokenLimit, DEFAULT_TOKEN_LIMIT } from '../utils';

describe('analysis common utils', () => {
  it('uses 25 as the default token limit when no value is provided', () => {
    expect(DEFAULT_TOKEN_LIMIT).toBe(25);
    expect(clampDisplayTokenLimit(undefined).limit).toBe(25);
    expect(clampDisplayTokenLimit(null).limit).toBe(25);
  });
});