import { beforeEach, describe, expect, it } from 'vitest';

import { useGuidanceAcknowledgmentsStore } from '../acknowledgmentsStore';

describe('guidance acknowledgment persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    useGuidanceAcknowledgmentsStore.setState({ byUser: {} });
  });

  it('migrates legacy publication hint IDs to Add to Workspace IDs', async () => {
    localStorage.setItem(
      'wordflow-guidance-acknowledgments',
      JSON.stringify({
        state: {
          byUser: {
            'user-1': {
              'concordance.publish': 2,
              'concordance.add-to-workspace': 1,
              'topic-modeling.publish': 3,
              'quotation.publish': 1,
            },
          },
        },
        version: 0,
      }),
    );

    await useGuidanceAcknowledgmentsStore.persist.rehydrate();

    expect(useGuidanceAcknowledgmentsStore.getState().byUser['user-1']).toEqual({
      'concordance.add-to-workspace': 2,
      'topic-modeling.add-to-workspace': 3,
      'quotation.add-to-workspace': 1,
    });
  });
});
