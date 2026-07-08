import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiRequestError } from '../api';

/**
 * Базовый хук для async-запросов с автоматической отменой.
 *
 * Исправление: в оригинале каждый хук (useNodes, useProxies и т.д.) дублировал
 * одну и ту же логику — loading/error/data state + AbortController.
 * Теперь единая реализация, которая принимает fetcher-функцию.
 */
export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export interface UseAsyncOptions {
  /** Выполнить запрос сразу при монтировании. По умолчанию true. */
  immediate?: boolean;
  /** Интервал автообновления в мс. 0 = отключено. */
  pollIntervalMs?: number;
}

export interface UseAsyncResult<T, TArgs extends unknown[]> extends AsyncState<T> {
  refetch: (...args: TArgs) => Promise<void>;
  /** Отменяет текущий запрос (например, при unmount). */
  cancel: () => void;
}

export function useAsync<T, TArgs extends unknown[] = []>(
  fetcher: (...args: TArgs) => Promise<T>,
  options: UseAsyncOptions = {}
): UseAsyncResult<T, TArgs> {
  const { immediate = true, pollIntervalMs = 0 } = options;
  const [state, setState] = useState<AsyncState<T>>({ data: null, loading: false, error: null });
  const abortRef = useRef<AbortController | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const refetch = useCallback(async (...args: TArgs) => {
    cancel();
    const controller = new AbortController();
    abortRef.current = controller;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetcher(...args);
      if (!controller.signal.aborted) {
        setState({ data, loading: false, error: null });
      }
    } catch (err: any) {
      if (controller.signal.aborted) return;
      const message = err instanceof ApiRequestError ? err.message : (err?.message || 'Unknown error');
      setState((s) => ({ ...s, loading: false, error: message }));
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [fetcher, cancel]);

  useEffect(() => {
    if (immediate) refetch(...([] as unknown as TArgs));
    return () => {
      cancel();
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [immediate, refetch, cancel]);

  useEffect(() => {
    if (pollIntervalMs > 0) {
      pollRef.current = setInterval(() => {
        refetch(...([] as unknown as TArgs));
      }, pollIntervalMs);
      return () => {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      };
    }
    return undefined;
  }, [pollIntervalMs, refetch]);

  return { ...state, refetch, cancel };
}
