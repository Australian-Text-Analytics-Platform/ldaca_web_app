// @vitest-environment node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(
  path.resolve(import.meta.dirname, '../../App.tsx'),
  'utf8'
);

describe('App code splitting', () => {
  it('lazy-loads the heavy workspace panel and feedback modal modules', () => {
    expect(appSource).toContain("lazy(() => import('./components/layout/WorkspaceView'))");
  });
});