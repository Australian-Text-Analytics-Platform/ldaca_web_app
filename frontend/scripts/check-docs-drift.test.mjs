import { describe, expect, it } from 'vitest';

import { collectDocumentationProblems, collectWorkflowProblems } from './check-docs-drift.mjs';

const registry = {
  tutorial: {
    existing: {
      file: 'tutorials/existing.md',
      anchor: 'help-existing',
    },
    'missing-file': {
      file: 'tutorials/missing.md',
      anchor: 'help-missing',
    },
    'missing-anchor': {
      file: 'tutorials/existing.md',
      anchor: 'help-not-present',
    },
  },
  info: {},
  reference: {},
};

describe('documentation drift validation', () => {
  it('reports missing registered files and anchors', () => {
    const problems = collectDocumentationProblems({
      registry,
      documents: new Map([
        [
          'tutorials/existing.md',
          '<h1 id="help-existing">Existing</h1>\n[Next](./next.md#help-next)',
        ],
        ['tutorials/next.md', '<h2 id="help-next">Next</h2>'],
      ]),
    });

    expect(problems).toContain('tutorial:missing-file points to missing file tutorials/missing.md');
    expect(problems).toContain(
      'tutorial:missing-anchor points to missing anchor #help-not-present in tutorials/existing.md',
    );
  });

  it('reports broken relative document and anchor links', () => {
    const problems = collectDocumentationProblems({
      registry: {
        tutorial: {
          existing: registry.tutorial.existing,
        },
        info: {},
        reference: {},
      },
      documents: new Map([
        [
          'tutorials/existing.md',
          [
            '<h1 id="help-existing">Existing</h1>',
            '[Missing file](./absent.md)',
            '[Missing anchor](./next.md#help-absent)',
            '[External](https://example.com/docs)',
          ].join('\n'),
        ],
        ['tutorials/next.md', '<h2 id="help-next">Next</h2>'],
      ]),
    });

    expect(problems).toContain(
      'tutorials/existing.md links to missing relative file tutorials/absent.md',
    );
    expect(problems).toContain(
      'tutorials/existing.md links to missing anchor #help-absent in tutorials/next.md',
    );
    expect(problems.some((problem) => problem.includes('example.com'))).toBe(false);
  });

  it('reports orphan documents outside the registered and linked graph', () => {
    const problems = collectDocumentationProblems({
      registry: {
        tutorial: { existing: registry.tutorial.existing },
        info: {},
        reference: {},
      },
      documents: new Map([
        ['tutorials/existing.md', '<h1 id="help-existing">Existing</h1>'],
        ['warnings/orphan.md', '# Orphan'],
      ]),
    });

    expect(problems).toContain(
      'warnings/orphan.md is not registered or reachable from registered documentation',
    );
  });
});

describe('documentation drift workflow validation', () => {
  it('requires docs, registry, validator, and validator tests to trigger the executable check', () => {
    const workflow = [
      'on:',
      '  pull_request:',
      '    paths:',
      "      - 'frontend/src/**/*.tsx'",
      'jobs:',
      '  drift:',
      '    steps:',
      '      - run: echo skipped',
    ].join('\n');

    expect(collectWorkflowProblems(workflow)).toEqual([
      'workflow does not trigger for frontend/public documentation',
      'workflow does not trigger for the bundled registry',
      'workflow does not trigger for the drift validator tests',
      'workflow does not execute scripts/check-docs-drift.mjs',
    ]);
  });
});
