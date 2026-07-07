import { useCallback } from 'react';
import {
  getProxy,
  getProxyStats,
  getProxyLink,
  getProxyStatsHistory,
  getProxyIpHistory,
  updateProxy,
  deleteProxy,
  restartProxy,
  pauseProxy,
  unpauseProxy,
  clearProxyHistory,
  type ProxyConfig,
  type ProxyStats,
  type ProxyUpdateRequest,
  type IpHistoryEntry,
  type StatsSnapshot,
} from '../api';
import { useAsync } from './useAsync';

interface UseProxyDetailOptions {
  nodeId: number;
  proxyId: string;
  pollIntervalMs?: number;
}

export function useProxyDetail({ nodeId, proxyId, pollIntervalMs = 5000 }: UseProxyDetailOptions) {
  const fetcher = useCallback(
    () => Promise.all([getProxy(nodeId, proxyId), getProxyStats(nodeId, proxyId)]),
    [nodeId, proxyId]
  );

  const async_ = useAsync<[ProxyConfig, ProxyStats]>(fetcher, { pollIntervalMs });

  const update = useCallback(
    async (data: ProxyUpdateRequest) => {
      const updated = await updateProxy(nodeId, proxyId, data);
      await async_.refetch();
      return updated;
    },
    [nodeId, proxyId, async_]
  );

  const remove = useCallback(async () => {
    await deleteProxy(nodeId, proxyId);
  }, [nodeId, proxyId]);

  const restart = useCallback(async () => {
    return restartProxy(nodeId, proxyId);
  }, [nodeId, proxyId]);

  const pause = useCallback(async () => {
    return pauseProxy(nodeId, proxyId);
  }, [nodeId, proxyId]);

  const unpause = useCallback(async () => {
    return unpauseProxy(nodeId, proxyId);
  }, [nodeId, proxyId]);

  const getLink = useCallback(async () => {
    return getProxyLink(nodeId, proxyId);
  }, [nodeId, proxyId]);

  const clearHistory = useCallback(async () => {
    await clearProxyHistory(nodeId, proxyId);
  }, [nodeId, proxyId]);

  const loadStatsHistory = useCallback(
    () => getProxyStatsHistory(nodeId, proxyId),
    [nodeId, proxyId]
  );

  const loadIpHistory = useCallback(
    () => getProxyIpHistory(nodeId, proxyId),
    [nodeId, proxyId]
  );

  return {
    ...async_,
    update,
    remove,
    restart,
    pause,
    unpause,
    getLink,
    clearHistory,
    loadStatsHistory,
    loadIpHistory,
  };
}

export type { StatsSnapshot, IpHistoryEntry };
