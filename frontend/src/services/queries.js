import { useQuery } from '@tanstack/react-query';
/** Resolve mock data after a short latency so loading/skeleton states are real. */
function mockFetch(data, latency = 380) {
    return new Promise((resolve) => {
        setTimeout(() => resolve(data), latency);
    });
}
/**
 * Thin wrapper over React Query for the demo's static datasets — pages get the
 * full `isLoading` / `isError` / `data` lifecycle without a backend.
 */
export function useMockQuery(key, data, latency) {
    return useQuery({
        queryKey: key,
        queryFn: () => mockFetch(data, latency),
    });
}
