import type { ProcessPageFilters } from "../../types";

export const queryKeys = {
  clients: {
    all: ["clients"] as const,
  },
  processes: {
    all: ["processes"] as const,
    page: (clientId: string | null, filters: ProcessPageFilters, page: number, pageSize: number) =>
      ["processes", "page", clientId, filters, page, pageSize] as const,
    filters: (clientId: string | null) => ["processes", "filters", clientId] as const,
    detail: (processId: string) => ["processes", "detail", processId] as const,
  },
  risks: {
    all: ["risks"] as const,
  },
  phases: {
    all: ["phases"] as const,
  },
  workers: {
    all: ["workers"] as const,
  },
  searchRuns: {
    detail: (runId: string) => ["search-runs", runId] as const,
  },
};
