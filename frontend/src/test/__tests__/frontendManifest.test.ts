// @vitest-environment node

import { describe, expect, it } from 'vitest';
import packageJson from '../../../package.json';

describe('frontend manifest', () => {
  it('uses plugin-react v6 with the rolldown babel bridge for React Compiler', () => {
    const devDependencies = packageJson.devDependencies ?? {};

    expect(devDependencies['@vitejs/plugin-react']).toMatch(/^\^?6\./);
    expect(devDependencies['@rolldown/plugin-babel']).toBeTruthy();
    expect(devDependencies['@babel/core']).toBeTruthy();
  });
});