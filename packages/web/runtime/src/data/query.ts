'use client'
import { useContext, useCallback, type ContextType } from 'react'
import {
  hashKey,
  useQueryClient,
  useQuery as observeQuery,
  useQueries as observeQueries,
  type UseQueryOptions,
  type UseQueryResult,
  type QueryClient,
} from '@tanstack/react-query'
import { useHydrating } from '../document/hydrating.ts'
import { HandedReads, handedOptions } from './query-hydration.tsx'

// Preserve TanStack's overloads, including defined initial data, select and
// heterogeneous query tuples. The implementation only decorates observers;
// it never changes the client's defaults or another page's query options.
export const useQuery: typeof observeQuery = ((options: UseQueryOptions, client?: QueryClient) => {
  const cache = useQueryClient(client)
  const reads = useContext(HandedReads)
  const hydrating = useHydrating()
  const result = observeQuery(handedOptions(options, reads, cache), client)
  return responseResult(result, options, reads, hydrating)
}) as typeof observeQuery

export const useQueries: typeof observeQueries = ((
  options: {
    queries: readonly UseQueryOptions[]
    combine?: (results: UseQueryResult[]) => unknown
    subscribed?: boolean
  },
  client?: QueryClient,
) => {
  const cache = useQueryClient(client)
  const reads = useContext(HandedReads)
  const hydrating = useHydrating()
  const { combine: combineResults, queries } = options
  const combine = useCallback(
    (results: UseQueryResult[]) => {
      const shown = hydrating
        ? results.map((result, index) => responseResult(result, queries[index]!, reads, true))
        : results
      return combineResults ? combineResults(shown) : shown
    },
    [combineResults, queries, reads, hydrating],
  )
  return observeQueries(
    {
      ...options,
      queries: options.queries.map((query) => handedOptions(query, reads, cache)),
      combine,
    },
    client,
  )
}) as typeof observeQueries

function responseResult(
  result: UseQueryResult,
  options: UseQueryOptions,
  reads: ContextType<typeof HandedReads>,
  hydrating: boolean,
): UseQueryResult {
  const hash = hashKey(options.queryKey)
  if (!hydrating || !reads.has(hash)) return result
  const snapshot = reads.get(hash)
  let data = snapshot?.data
  let error = snapshot?.error ?? null
  let status = snapshot?.status ?? 'pending'
  if (status === 'success' && options.select) {
    try {
      data = options.select(data)
    } catch (caught) {
      error = caught as Error
      status = 'error'
      data = undefined
    }
  }
  const isPending = status === 'pending'
  const isError = status === 'error'
  const hasData = data !== undefined
  const isFetching = snapshot == null || snapshot.fetchStatus === 'fetching'
  // A delayed hydration boundary must draw its HTML snapshot once even if a
  // sibling already advanced the live cache. Keep methods bound to the live
  // observer, and let the next render use its normal result.
  return {
    ...result,
    data,
    error,
    status,
    dataUpdatedAt: snapshot?.dataUpdatedAt ?? 0,
    errorUpdatedAt: snapshot?.errorUpdatedAt ?? 0,
    fetchStatus: isFetching ? 'fetching' : 'idle',
    isPending,
    isError,
    isSuccess: status === 'success',
    isLoading: isPending && isFetching,
    isInitialLoading: isPending && isFetching,
    isFetching,
    isRefetching: isFetching && !isPending,
    isLoadingError: isError && !hasData,
    isRefetchError: isError && hasData,
    isPlaceholderData: false,
    isPaused: snapshot?.fetchStatus === 'paused',
    failureCount: snapshot?.fetchFailureCount ?? 0,
    failureReason: snapshot?.fetchFailureReason ?? null,
    errorUpdateCount: snapshot?.errorUpdateCount ?? 0,
    isFetched: (snapshot?.dataUpdateCount ?? 0) + (snapshot?.errorUpdateCount ?? 0) > 0,
    isFetchedAfterMount: false,
  } as UseQueryResult
}
