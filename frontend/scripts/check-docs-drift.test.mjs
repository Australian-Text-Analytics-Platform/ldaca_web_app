import { describe, expect, it } from 'vitest';

import { collectDocumentationProblems } from './check-docs-drift.mjs';

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

  it('resolves nested document links relative to the current document', () => {
    const problems = collectDocumentationProblems({
      registry: {
        tutorial: {
          current: {
            file: 'tutorials/guides/current.md',
            anchor: 'help-current',
          },
        },
        info: {},
        reference: {},
      },
      documents: new Map([
        [
          'tutorials/guides/current.md',
          '<h1 id="help-current">Current</h1>\n[Next](tutorials/next.md#help-next)',
        ],
        ['tutorials/next.md', '<h2 id="help-next">Next</h2>'],
      ]),
    });

    expect(problems).toContain(
      'tutorials/guides/current.md links to missing relative file tutorials/guides/tutorials/next.md',
    );
  });

  it('resolves leading-slash document links from the public root', () => {
    const problems = collectDocumentationProblems({
      registry: {
        tutorial: {
          current: {
            file: 'tutorials/guides/current.md',
            anchor: 'help-current',
          },
        },
        info: {},
        reference: {},
      },
      documents: new Map([
        [
          'tutorials/guides/current.md',
          '<h1 id="help-current">Current</h1>\n[Next](/tutorials/next.md#help-next)',
        ],
        ['tutorials/next.md', '<h2 id="help-next">Next</h2>'],
      ]),
    });

    expect(problems).toEqual([]);
  });

  it('does not intercept uppercase Markdown extensions as document navigation', () => {
    const problems = collectDocumentationProblems({
      registry: {
        tutorial: {
          current: {
            file: 'tutorials/guides/current.md',
            anchor: 'help-current',
          },
        },
        info: {},
        reference: {},
      },
      documents: new Map([
        ['tutorials/guides/current.md', '<h1 id="help-current">Current</h1>\n[Next](next.MD#next)'],
        ['tutorials/guides/next.MD', '<h2 id="next">Next</h2>'],
      ]),
    });

    expect(problems).toContain(
      'tutorials/guides/current.md links to missing relative file next.MD',
    );
  });

  it('does not intercept query-suffixed Markdown hrefs as document navigation', () => {
    const problems = collectDocumentationProblems({
      registry: {
        tutorial: {
          current: {
            file: 'tutorials/guides/current.md',
            anchor: 'help-current',
          },
        },
        info: {},
        reference: {},
      },
      documents: new Map([
        [
          'tutorials/guides/current.md',
          '<h1 id="help-current">Current</h1>\n[Next](next.md?mode=1#next)',
        ],
        ['tutorials/guides/next.md', '<h2 id="next">Next</h2>'],
      ]),
    });

    expect(problems).toContain(
      'tutorials/guides/current.md links to missing relative file next.md',
    );
  });

  it('keeps encoded document anchors literal like the rendered viewer', () => {
    const problems = collectDocumentationProblems({
      registry: {
        tutorial: {
          current: {
            file: 'tutorials/guides/current.md',
            anchor: 'help-current',
          },
        },
        info: {},
        reference: {},
      },
      documents: new Map([
        [
          'tutorials/guides/current.md',
          '<h1 id="help-current">Current</h1>\n[Next](next.md#next%20section)',
        ],
        ['tutorials/guides/next.md', '<h2 id="next section">Next</h2>'],
      ]),
    });

    expect(problems).toContain(
      'tutorials/guides/current.md links to missing anchor #next%20section in tutorials/guides/next.md',
    );
  });

  it('resolves nested document images from the public root with or without a leading slash', () => {
    const documents = new Map([
      [
        'tutorials/guides/current.md',
        [
          '<h1 id="help-current">Current</h1>',
          '![Public asset](tutorials/assets/x.png)',
          '<img alt="Root asset" src="/tutorials/assets/y.png">',
          '<a href="tutorials/assets/z.png">Linked asset</a>',
        ].join('\n'),
      ],
    ]);
    const problems = collectDocumentationProblems({
      registry: {
        tutorial: {
          current: {
            file: 'tutorials/guides/current.md',
            anchor: 'help-current',
          },
        },
        info: {},
        reference: {},
      },
      documents,
      availablePaths: new Set([
        ...documents.keys(),
        'tutorials/assets/x.png',
        'tutorials/assets/y.png',
        'tutorials/assets/z.png',
      ]),
    });

    expect(problems).toEqual([]);
  });

  it('rejects anchors that exist only as Markdown headings', () => {
    const problems = collectDocumentationProblems({
      registry: {
        tutorial: {
          heading: {
            file: 'tutorials/heading.md',
            anchor: 'markdown-heading',
          },
        },
        info: {},
        reference: {},
      },
      documents: new Map([['tutorials/heading.md', '# Markdown heading']]),
    });

    expect(problems).toContain(
      'tutorial:heading points to missing anchor #markdown-heading in tutorials/heading.md',
    );
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
