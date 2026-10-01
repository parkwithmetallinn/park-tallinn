import { QueryClient } from '@tanstack/react-query'

/** Shared QueryClient — stale-while-revalidate defaults for ParkVibe. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
})

export const parkingQueryKeys = {
  polygons: ['parking', 'polygons'] as const,
  streets: ['parking', 'streets'] as const,
  sessions: ['parking', 'active-sessions'] as const,
  requests: ['parking', 'moderation-requests'] as const,
}
