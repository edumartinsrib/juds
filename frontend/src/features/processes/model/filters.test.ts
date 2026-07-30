import { describe, expect, it } from "vitest";

import {
  activeProcessFilters,
  defaultProcessFilters,
  processFiltersFromParams,
  processFiltersToParams,
} from "./filters";

describe("process filter URL model", () => {
  it("recupera filtros compartilháveis da URL", () => {
    const filters = processFiltersFromParams(
      new URLSearchParams("risco=alto&tribunal=TJPR&parte=Marina"),
    );
    expect(filters).toEqual({
      ...defaultProcessFilters,
      riskFilter: "alto",
      tribunal: "TJPR",
      partyName: "Marina",
    });
    expect(activeProcessFilters(filters)).toHaveLength(3);
  });

  it("preserva contexto alheio e reinicia a página ao aplicar filtros", () => {
    const result = processFiltersToParams(
      new URLSearchParams("client=client-1&page=8&density=compact"),
      { ...defaultProcessFilters, processNumber: "0000282" },
    );
    expect(result.get("client")).toBe("client-1");
    expect(result.get("density")).toBe("compact");
    expect(result.get("processo")).toBe("0000282");
    expect(result.get("page")).toBe("1");
  });
});
