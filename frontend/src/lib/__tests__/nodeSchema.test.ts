import { Field, Utf8 } from 'apache-arrow';
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getNodeSchemaTableMock = vi.hoisted(() => vi.fn());

vi.mock('@/api/tableApi', () => ({ getNodeSchemaTable: getNodeSchemaTableMock }));

import { fetchNodeSchema, nodeSchemaQueryOptions } from '../nodeSchema';

describe('node Arrow schema cache', () => {
  beforeEach(() => getNodeSchemaTableMock.mockReset());

  it('deduplicates schema reads by workspace and node', async () => {
    const schema = [{ name: 'text', field: new Field('text', new Utf8()) }];
    getNodeSchemaTableMock.mockResolvedValue({ schema });
    const queryClient = new QueryClient();

    await expect(
      fetchNodeSchema({ queryClient, workspaceId: 'workspace-1', nodeId: 'node-1' }),
    ).resolves.toBe(schema);
    await expect(
      fetchNodeSchema({ queryClient, workspaceId: 'workspace-1', nodeId: 'node-1' }),
    ).resolves.toBe(schema);

    expect(getNodeSchemaTableMock).toHaveBeenCalledTimes(1);
    queryClient.clear();
  });

  it('defines no fallback data for a failed schema query', () => {
    const options = nodeSchemaQueryOptions({ workspaceId: 'workspace-1', nodeId: 'node-1' });

    expect(options).not.toHaveProperty('initialData');
    expect(options).not.toHaveProperty('placeholderData');
  });
});
