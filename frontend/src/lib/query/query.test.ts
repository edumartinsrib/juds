import { describe, expect, it } from "vitest";

import { defaultProcessFilters } from "../../features/processes/model/filters";
import { createQueryClient } from "./client";
import { queryKeys } from "./keys";

describe("query configuration", () => {
  it("aplica cache previsível e não repete erros do cliente", () => {
    const options = createQueryClient().getDefaultOptions();
    expect(options.queries?.staleTime).toBe(30_000);
    expect(options.queries?.gcTime).toBe(300_000);
    expect(options.queries?.refetchOnWindowFocus).toBe(false);
    expect(options.mutations?.retry).toBe(false);

    const retry = options.queries?.retry as (
      failureCount: number,
      error: Error & { status?: number },
    ) => boolean;
    expect(retry(0, Object.assign(new Error("inválido"), { status: 422 }))).toBe(false);
    expect(retry(0, new Error("instável"))).toBe(true);
    expect(retry(2, new Error("instável"))).toBe(false);
  });

  it("gera chaves estáveis por domínio e contexto", () => {
    expect(queryKeys.clients.all).toEqual(["clients"]);
    expect(queryKeys.processes.page("client-1", defaultProcessFilters, 2, 20)).toEqual([
      "processes",
      "page",
      "client-1",
      defaultProcessFilters,
      2,
      20,
    ]);
    expect(queryKeys.processes.filters(null)).toEqual(["processes", "filters", null]);
    expect(queryKeys.processes.detail("process-1")).toEqual(["processes", "detail", "process-1"]);
    expect(queryKeys.risks.all).toEqual(["risks"]);
    expect(queryKeys.phases.all).toEqual(["phases"]);
    expect(queryKeys.workers.all).toEqual(["workers"]);
    expect(queryKeys.searchRuns.detail("run-1")).toEqual(["search-runs", "run-1"]);
  });
});
