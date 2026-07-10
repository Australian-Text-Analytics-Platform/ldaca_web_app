import { describe, expect, it } from 'vitest';

import {
  createFileBrowserCitationState,
  fileBrowserCitationReducer,
} from '../fileBrowserCitationState';

const directory = {
  type: 'directory' as const,
  name: 'corpus',
  path: '/data/corpus',
  children: [],
};

describe('fileBrowserCitationState', () => {
  it('opens folders without README content as an empty citation dialog', () => {
    expect(
      fileBrowserCitationReducer(createFileBrowserCitationState(), {
        type: 'openWithoutReadme',
        directory,
      }),
    ).toEqual({
      directory,
      path: null,
      content: null,
      loading: false,
    });
  });

  it('tracks README loading and stores returned content', () => {
    const loading = fileBrowserCitationReducer(createFileBrowserCitationState(), {
      type: 'startLoading',
      directory,
      path: '/data/corpus/README.md',
    });

    expect(loading).toMatchObject({
      directory,
      path: '/data/corpus/README.md',
      content: null,
      loading: true,
    });

    expect(
      fileBrowserCitationReducer(loading, { type: 'loaded', content: '# Citation' }),
    ).toMatchObject({
      directory,
      path: '/data/corpus/README.md',
      content: '# Citation',
      loading: false,
    });
  });

  it('closes or fails without leaving stale loading state', () => {
    const loading = fileBrowserCitationReducer(createFileBrowserCitationState(), {
      type: 'startLoading',
      directory,
      path: '/data/corpus/README.md',
    });

    expect(fileBrowserCitationReducer(loading, { type: 'failed' })).toMatchObject({
      directory,
      path: '/data/corpus/README.md',
      content: null,
      loading: false,
    });
    expect(fileBrowserCitationReducer(loading, { type: 'close' })).toEqual(
      createFileBrowserCitationState(),
    );
  });
});
