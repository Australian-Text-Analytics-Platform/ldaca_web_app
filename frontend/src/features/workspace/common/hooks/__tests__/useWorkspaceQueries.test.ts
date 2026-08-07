import { describe, expect, it } from 'vitest';
import type { WorkspaceCatalogueItem } from '@/api';
import { availableWorkspacesFromCatalogue } from '../useWorkspaceQueries';

describe('availableWorkspacesFromCatalogue', () => {
  it('excludes unavailable entries from runtime Workspace derivation', () => {
    const catalogue: WorkspaceCatalogueItem[] = [
      {
        availability: 'unavailable',
        id: '0a120442-2f33-4474-9d09-9adbdfea7ebc',
        reason: 'incompatible_format',
        message: 'Workspace format 14 is incompatible with supported format 15.',
        stored_schema_version: 14,
        supported_schema_version: 15,
      },
      {
        availability: 'available',
        id: '59be3a7c-05c7-4849-a215-86b6bff6704c',
        name: 'Available',
        description: '',
        created_at: '2026-08-07T00:00:00Z',
        modified_at: '2026-08-08T00:00:00Z',
        total_nodes: 5,
        root_nodes: 5,
        leaf_nodes: 5,
        revision: 1,
        runtime_state: 'open',
      },
    ];

    expect(availableWorkspacesFromCatalogue(catalogue)).toEqual([catalogue[1]]);
  });
});
