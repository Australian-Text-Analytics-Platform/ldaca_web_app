import { describe, expect, it } from 'vitest';

import { getTutorialTarget } from './tutorialRegistry';

describe('tutorialRegistry', () => {
  it('returns null for missing targets', () => {
    expect(getTutorialTarget('missing.key')).toBeNull();
  });

  it('returns a tutorial target for known keys', () => {
    const target = getTutorialTarget('data-loader.upload.button');
    expect(target).not.toBeNull();
    expect(target?.file).toContain('tutorials/');
    expect(target?.anchor).toContain('help-');
  });

  it('returns a tutorial target for the workspace manager help', () => {
    const target = getTutorialTarget('data-loader.workspace-manager.section');
    expect(target).not.toBeNull();
    expect(target?.file).toContain('tutorials/data-loader.md');
    expect(target?.anchor).toBe('help-data-loader-workspace-manager');
  });
});
