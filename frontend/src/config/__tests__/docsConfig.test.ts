import { describe, expect, it } from 'vitest';

import { docsBaseUrlFor, docsMinorTagFor } from '../env';

describe('versioned documentation configuration', () => {
  it('derives the matching minor tag from the application version', () => {
    expect(docsMinorTagFor('0.7.1')).toBe('v0.7');
    expect(docsMinorTagFor('12.34.0-beta.1')).toBe('v12.34');
  });

  it('uses bundled-only documentation when configuration is incomplete', () => {
    expect(docsBaseUrlFor('', '0.7.1')).toBe('');
    expect(docsBaseUrlFor('https://docs.example.com', 'not-semver')).toBe('');
  });

  it('appends the minor tag to the deployment origin', () => {
    expect(docsBaseUrlFor('https://docs.example.com/wordflow/', '0.7.1')).toBe(
      'https://docs.example.com/wordflow/v0.7',
    );
  });
});
