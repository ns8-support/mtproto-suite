import { useCallback } from 'react';
import { listAllProxies, type NodeWithProxies } from '../api';
import { useAsync } from './useAsync';

/**
 * Хук для получения всех прокси со всех нод.
 *
 * Исправление: в оригинале polling интервал был захардкожен в каждом хуке
 * (30000 мс, 5000 мс, 60000 мс...). Теперь вынесено в опции useAsync.
 */
export function useAllProxies(pollIntervalMs = 30000) {
  const fetcher = useCallback(() => listAllProxies(), []);
  return useAsync<NodeWithProxies[]>(fetcher, { pollIntervalMs });
}
