import type { ProcessPageFilters } from "../../../types";

export const defaultProcessFilters: ProcessPageFilters = {
  riskFilter: "todos",
  processClass: "",
  tribunal: "",
  dataStatus: "",
  agency: "",
  processNumber: "",
  partyName: "",
  defendant: "",
};

const filterParamMap: Record<keyof ProcessPageFilters, string> = {
  riskFilter: "risco",
  processClass: "classe",
  tribunal: "tribunal",
  dataStatus: "dados",
  agency: "orgao",
  processNumber: "processo",
  partyName: "parte",
  defendant: "reu",
};

export function processFiltersFromParams(params: URLSearchParams): ProcessPageFilters {
  return Object.fromEntries(
    Object.entries(filterParamMap).map(([key, param]) => [
      key,
      params.get(param) ?? defaultProcessFilters[key as keyof ProcessPageFilters],
    ]),
  ) as ProcessPageFilters;
}

export function processFiltersToParams(
  current: URLSearchParams,
  filters: ProcessPageFilters,
): URLSearchParams {
  const next = new URLSearchParams(current);
  for (const [key, param] of Object.entries(filterParamMap)) {
    const value = filters[key as keyof ProcessPageFilters].trim();
    if (value && !(key === "riskFilter" && value === "todos")) {
      next.set(param, value);
    } else {
      next.delete(param);
    }
  }
  next.set("page", "1");
  return next;
}

export function activeProcessFilters(filters: ProcessPageFilters) {
  return (Object.keys(filters) as Array<keyof ProcessPageFilters>)
    .filter((key) => {
      const value = filters[key];
      return Boolean(value) && !(key === "riskFilter" && value === "todos");
    })
    .map((key) => ({ key, value: filters[key], param: filterParamMap[key] }));
}

export function normalizeProcessFilters(filters: ProcessPageFilters): ProcessPageFilters {
  return {
    ...filters,
    riskFilter: filters.riskFilter || "todos",
    processClass: filters.processClass.trim(),
    tribunal: filters.tribunal.trim(),
    dataStatus: filters.dataStatus.trim(),
    agency: filters.agency.trim(),
    processNumber: filters.processNumber.trim(),
    partyName: filters.partyName.trim(),
    defendant: filters.defendant.trim(),
  };
}
