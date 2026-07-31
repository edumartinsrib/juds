import { QueryClient } from "@tanstack/react-query";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          const status = "status" in error && typeof error.status === "number" ? error.status : 0;
          return status >= 400 && status < 500 ? false : failureCount < 2;
        },
      },
      mutations: {
        retry: false,
      },
    },
  });
}
