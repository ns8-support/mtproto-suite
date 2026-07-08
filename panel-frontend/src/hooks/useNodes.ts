import { useCallback } from 'react';
import { listNodes, addNode, updateNode, deleteNode, getNodeHealth, type NodeInfo } from '../api';
import { useAsync } from './useAsync';

export function useNodes() {
  const fetcher = useCallback(() => listNodes(), []);
  const async_ = useAsync<NodeInfo[]>(fetcher, { pollIntervalMs: 0 });

  const create = useCallback(async (data: { name?: string; ip: string; port: number; token: string; domain?: string }) => {
    const created = await addNode(data);
    await async_.refetch();
    return created;
  }, [async_]);

  const update = useCallback(async (id: number, data: Partial<NodeInfo & { token: string }>) => {
    const updated = await updateNode(id, data);
    await async_.refetch();
    return updated;
  }, [async_]);

  const remove = useCallback(async (id: number) => {
    await deleteNode(id);
    await async_.refetch();
  }, [async_]);

  const refreshHealth = useCallback(async (id: number) => {
    return getNodeHealth(id);
  }, []);

  return { ...async_, create, update, remove, refreshHealth };
}
