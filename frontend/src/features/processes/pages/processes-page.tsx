import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Ellipsis,
  Filter,
  LayoutList,
  Plus,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { getProcess, getProcessFilterOptions, listProcessesPage } from "../../../api";
import {
  ProcessCard,
  PartiesSummary,
  PhaseBadge,
  RiskBadge,
  DataStatusBadge,
} from "../../../components/domain/process";
import {
  EmptyState,
  ErrorState,
  InlineAlert,
  PageSkeleton,
} from "../../../components/feedback/states";
import { PageHeader } from "../../../components/layout/page-header";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Dialog } from "../../../components/ui/dialog";
import { Drawer } from "../../../components/ui/drawer";
import { DropdownMenu, DropdownMenuItem } from "../../../components/ui/dropdown-menu";
import { Field, Input, Select } from "../../../components/ui/field";
import { Pagination } from "../../../components/ui/pagination";
import { cn } from "../../../lib/cn";
import { formatDate, statusLabel } from "../../../lib/formatters";
import { useDebouncedValue } from "../../../lib/hooks/use-debounced-value";
import { queryKeys } from "../../../lib/query/keys";
import { readStorage, writeStorage } from "../../../lib/storage";
import type { ProcessListItem, ProcessPageFilters } from "../../../types";
import {
  activeProcessFilters,
  defaultProcessFilters,
  processFiltersFromParams,
  processFiltersToParams,
} from "../model/filters";

type ColumnKey = "process" | "parties" | "phase" | "risk" | "tribunal" | "status" | "last";
type SortKey = "process" | "risk" | "last" | "phase";
type Density = "comfortable" | "compact";

type SavedView = {
  id: string;
  name: string;
  filters: ProcessPageFilters;
};

const defaultViews: SavedView[] = [
  {
    id: "high-risk",
    name: "Alto risco",
    filters: { ...defaultProcessFilters, riskFilter: "alto" },
  },
  {
    id: "outdated",
    name: "Sem atualização",
    filters: { ...defaultProcessFilters, dataStatus: "pending" },
  },
  {
    id: "new-movements",
    name: "Novos movimentos",
    filters: { ...defaultProcessFilters },
  },
];

const columnLabels: Record<ColumnKey, string> = {
  process: "Processo",
  parties: "Partes",
  phase: "Fase",
  risk: "Risco",
  tribunal: "Tribunal",
  status: "Dados",
  last: "Última movimentação",
};

function sortProcesses(
  items: ProcessListItem[],
  sort: SortKey,
  direction: "asc" | "desc",
): ProcessListItem[] {
  const riskOrder: Record<string, number> = { critico: 4, alto: 3, medio: 2, baixo: 1 };
  const sorted = [...items].sort((first, second) => {
    if (sort === "risk") {
      return (
        (riskOrder[first.highest_risk_level ?? ""] ?? 0) -
        (riskOrder[second.highest_risk_level ?? ""] ?? 0)
      );
    }
    if (sort === "last") {
      return (
        Date.parse(first.last_movement_at ?? "1970-01-01") -
        Date.parse(second.last_movement_at ?? "1970-01-01")
      );
    }
    if (sort === "phase") {
      return (first.current_phase?.phase_order ?? 999) - (second.current_phase?.phase_order ?? 999);
    }
    return first.formatted_number.localeCompare(second.formatted_number, "pt-BR");
  });
  return direction === "desc" ? sorted.reverse() : sorted;
}

export default function ProcessesPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const [savedViews, setSavedViews] = useState<SavedView[]>(() => [
    ...defaultViews,
    ...readStorage<SavedView[]>("juds:process-views", []),
  ]);

  const clientId = params.get("client");
  const page = Math.max(1, Number(params.get("page")) || 1);
  const pageSize = [10, 20, 50].includes(Number(params.get("pageSize")))
    ? Number(params.get("pageSize"))
    : 20;
  const sort = (params.get("sort") as SortKey | null) ?? "last";
  const direction = params.get("dir") === "asc" ? "asc" : "desc";
  const density = (params.get("density") as Density | null) ?? "comfortable";
  const defaultColumns: ColumnKey[] = [
    "process",
    "parties",
    "phase",
    "risk",
    "tribunal",
    "status",
    "last",
  ];
  const visibleColumns = (params
    .get("cols")
    ?.split(",")
    .filter((column) => column in columnLabels) ?? defaultColumns) as ColumnKey[];
  const filters = useMemo(() => processFiltersFromParams(params), [params]);
  const [processSearch, setProcessSearch] = useState(filters.processNumber);
  const [partySearch, setPartySearch] = useState(filters.partyName);
  const [advancedDraft, setAdvancedDraft] = useState(filters);
  const debouncedProcess = useDebouncedValue(processSearch, 350);
  const debouncedParty = useDebouncedValue(partySearch, 350);
  const syncingSearchFromUrl = useRef(false);

  useEffect(() => {
    // The URL is the external source of truth when users navigate back or apply a saved view.
    syncingSearchFromUrl.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProcessSearch(filters.processNumber);
    setPartySearch(filters.partyName);
    setAdvancedDraft(filters);
  }, [filters]);

  useEffect(() => {
    if (syncingSearchFromUrl.current) {
      if (debouncedProcess === filters.processNumber && debouncedParty === filters.partyName) {
        syncingSearchFromUrl.current = false;
      }
      return;
    }
    if (debouncedProcess === filters.processNumber && debouncedParty === filters.partyName) {
      return;
    }
    setParams(
      processFiltersToParams(params, {
        ...filters,
        processNumber: debouncedProcess,
        partyName: debouncedParty,
      }),
      { replace: true },
    );
  }, [debouncedParty, debouncedProcess, filters, params, setParams]);

  useEffect(() => {
    const saved = sessionStorage.getItem("juds:process-list-scroll");
    if (!saved) {
      return;
    }
    let top = 0;
    try {
      const parsed = JSON.parse(saved) as { returnTo?: string; top?: number };
      if (parsed.returnTo !== `${location.pathname}${location.search}`) {
        return;
      }
      top = parsed.top ?? 0;
    } catch {
      top = Number(saved) || 0;
    }
    sessionStorage.removeItem("juds:process-list-scroll");
    const frame = window.requestAnimationFrame(() => window.scrollTo({ top }));
    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname, location.search]);

  const filtersQuery = useQuery({
    queryKey: queryKeys.processes.filters(clientId),
    queryFn: ({ signal }) => getProcessFilterOptions(clientId, signal),
  });
  const processesQuery = useQuery({
    queryKey: queryKeys.processes.page(clientId, filters, page, pageSize),
    queryFn: ({ signal }) => listProcessesPage({ clientId, ...filters, page, pageSize, signal }),
    placeholderData: (previous) => previous,
  });
  const processPage = processesQuery.data;
  const processes = useMemo(
    () => sortProcesses(processPage?.items ?? [], sort, direction),
    [direction, processPage?.items, sort],
  );
  const activeFilters = activeProcessFilters(filters);

  function updateParams(patch: Record<string, string | null>, replace = true) {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([key, value]) => {
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
    });
    setParams(next, { replace });
  }

  function applyFilters(nextFilters: ProcessPageFilters) {
    syncingSearchFromUrl.current = true;
    setProcessSearch(nextFilters.processNumber);
    setPartySearch(nextFilters.partyName);
    setAdvancedDraft(nextFilters);
    setParams(processFiltersToParams(params, nextFilters));
    setAdvancedOpen(false);
  }

  function updateProcessSearch(value: string) {
    syncingSearchFromUrl.current = false;
    setProcessSearch(value);
  }

  function updatePartySearch(value: string) {
    syncingSearchFromUrl.current = false;
    setPartySearch(value);
  }

  function removeFilter(key: keyof ProcessPageFilters) {
    applyFilters({
      ...filters,
      [key]: key === "riskFilter" ? "todos" : "",
    });
  }

  function prefetch(processId: string) {
    queryClient.prefetchQuery({
      queryKey: queryKeys.processes.detail(processId),
      queryFn: () => getProcess(processId),
      staleTime: 30_000,
    });
  }

  function openProcess(processId: string) {
    rememberScroll();
    navigate(`/processos/${processId}/visao-geral${location.search}`, {
      state: { returnTo: `${location.pathname}${location.search}` },
    });
  }

  function rememberScroll() {
    sessionStorage.setItem(
      "juds:process-list-scroll",
      JSON.stringify({
        returnTo: `${location.pathname}${location.search}`,
        top: window.scrollY,
      }),
    );
  }

  function toggleColumn(column: ColumnKey) {
    const next = visibleColumns.includes(column)
      ? visibleColumns.filter((item) => item !== column)
      : [...visibleColumns, column];
    if (!next.includes("process")) {
      next.unshift("process");
    }
    updateParams({ cols: next.join(",") });
  }

  function saveView() {
    if (!viewName.trim()) {
      return;
    }
    const custom = savedViews.filter((view) => !defaultViews.some((item) => item.id === view.id));
    const next: SavedView = { id: crypto.randomUUID(), name: viewName.trim(), filters };
    writeStorage("juds:process-views", [next, ...custom].slice(0, 12));
    setSavedViews([...defaultViews, next, ...custom].slice(0, 15));
    setViewName("");
    setSaveViewOpen(false);
  }

  if (processesQuery.isLoading && !processPage) {
    return <PageSkeleton rows={6} />;
  }

  return (
    <div className={cn("v-stack gap-6")}>
      <PageHeader
        eyebrow="Carteira processual"
        title="Processos"
        description="Pesquise, filtre e abra um processo sem perder a posição ou o contexto atual."
        actions={
          <>
            <Button
              disabled={processesQuery.isFetching}
              onClick={() => {
                filtersQuery.refetch();
                processesQuery.refetch();
              }}
            >
              <RefreshCw
                className={cn({ "animate-spin": processesQuery.isFetching })}
                size={17}
                aria-hidden="true"
              />
              Atualizar
            </Button>
            <Button variant="primary" onClick={() => setAdvancedOpen(true)}>
              <Filter size={17} aria-hidden="true" />
              Filtros avançados
              {activeFilters.length ? <Badge>{activeFilters.length}</Badge> : null}
            </Button>
          </>
        }
      />

      <section className={cn("v-stack gap-4")} aria-label="Pesquisa e visualizações">
        <div className={cn("grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_auto]")}>
          <Field label="Número do processo" htmlFor="process-number-search">
            <div
              className={cn("h-stack items-center rounded-md border border-line bg-surface px-3")}
            >
              <Search className={cn("text-muted")} size={17} aria-hidden="true" />
              <Input
                id="process-number-search"
                className="border-0 bg-transparent font-mono shadow-none focus:ring-0"
                value={processSearch}
                placeholder="Digite o número ou um trecho"
                onChange={(event) => updateProcessSearch(event.target.value)}
              />
            </div>
          </Field>
          <Field label="Parte" htmlFor="process-party-search">
            <Input
              id="process-party-search"
              value={partySearch}
              placeholder="Autor, réu ou interessado"
              onChange={(event) => updatePartySearch(event.target.value)}
            />
          </Field>
          <div className={cn("h-stack items-end gap-2")}>
            <DropdownMenu
              label="Visualizações salvas"
              trigger={
                <Button>
                  <LayoutList size={17} aria-hidden="true" />
                  Visualizações
                </Button>
              }
            >
              {savedViews.map((view) => (
                <DropdownMenuItem key={view.id} onSelect={() => applyFilters(view.filters)}>
                  {view.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onSelect={() => setSaveViewOpen(true)}>
                <Plus size={15} aria-hidden="true" />
                Salvar visualização atual
              </DropdownMenuItem>
            </DropdownMenu>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Configurar tabela"
              onClick={() => setControlsOpen(true)}
            >
              <SlidersHorizontal size={18} aria-hidden="true" />
            </Button>
          </div>
        </div>
        {activeFilters.length ? (
          <div
            className={cn("h-stack flex-wrap items-center gap-2")}
            aria-label="Filtros aplicados"
          >
            <span className={cn("text-xs font-bold uppercase tracking-wide text-muted")}>
              Filtros
            </span>
            {activeFilters.map((filter) => (
              <button
                key={filter.key}
                className={cn("ui-badge gap-1 hover:border-brand hover:text-brand")}
                type="button"
                onClick={() => removeFilter(filter.key)}
                aria-label={`Remover filtro ${columnLabels[filter.key as ColumnKey] ?? filter.key}: ${filter.value}`}
              >
                {filter.key === "riskFilter"
                  ? "Risco"
                  : filter.key === "processClass"
                    ? "Classe"
                    : filter.key === "dataStatus"
                      ? "Dados"
                      : filter.key === "agency"
                        ? "Órgão"
                        : filter.key === "partyName"
                          ? "Parte"
                          : filter.key === "processNumber"
                            ? "Processo"
                            : filter.key === "defendant"
                              ? "Réu"
                              : "Tribunal"}
                : {filter.value}
                <X size={12} aria-hidden="true" />
              </button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => applyFilters(defaultProcessFilters)}>
              Limpar todos
            </Button>
          </div>
        ) : null}
      </section>

      {filtersQuery.error ? (
        <InlineAlert title="Algumas opções de filtro estão indisponíveis" tone="warning">
          A busca principal continua disponível. Tente atualizar antes de usar os filtros avançados.
        </InlineAlert>
      ) : null}

      {processesQuery.error ? (
        <ErrorState error={processesQuery.error} onRetry={() => processesQuery.refetch()} />
      ) : !processes.length ? (
        <EmptyState
          title="Nenhum processo corresponde aos filtros"
          description="Remova filtros ou ajuste os termos da pesquisa."
          action={
            <Button onClick={() => applyFilters(defaultProcessFilters)}>Remover filtros</Button>
          }
        />
      ) : (
        <>
          <div className={cn("grid gap-4 md:hidden")}>
            {processes.map((process) => (
              <ProcessCard
                key={process.id}
                process={process}
                to={`/processos/${process.id}/visao-geral${location.search}`}
                onPrefetch={() => prefetch(process.id)}
                onOpen={rememberScroll}
                action={
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Ações do processo ${process.formatted_number}`}
                  >
                    <Ellipsis size={18} aria-hidden="true" />
                  </Button>
                }
              />
            ))}
          </div>
          <div className={cn("hidden overflow-x-auto rounded-lg border border-line md:block")}>
            <table
              className={cn("ui-data-table", {
                "[&_td]:py-2 [&_th]:py-2": density === "compact",
              })}
            >
              <caption className={cn("sr-only")}>Processos encontrados</caption>
              <thead>
                <tr>
                  {visibleColumns.map((column) => {
                    const sortable = ["process", "phase", "risk", "last"].includes(column);
                    return (
                      <th
                        key={column}
                        scope="col"
                        aria-sort={
                          sort === column
                            ? direction === "asc"
                              ? "ascending"
                              : "descending"
                            : sortable
                              ? "none"
                              : undefined
                        }
                      >
                        {sortable ? (
                          <button
                            className={cn("h-stack items-center gap-1 rounded-sm text-left")}
                            type="button"
                            onClick={() =>
                              updateParams({
                                sort: column,
                                dir: sort === column && direction === "desc" ? "asc" : "desc",
                              })
                            }
                          >
                            {columnLabels[column]}
                            {sort === column ? (
                              direction === "asc" ? (
                                <ArrowUp size={13} aria-hidden="true" />
                              ) : (
                                <ArrowDown size={13} aria-hidden="true" />
                              )
                            ) : null}
                          </button>
                        ) : (
                          columnLabels[column]
                        )}
                      </th>
                    );
                  })}
                  <th scope="col">
                    <span className={cn("sr-only")}>Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {processes.map((process) => (
                  <tr
                    key={process.id}
                    className={cn("cursor-pointer")}
                    tabIndex={0}
                    onClick={() => openProcess(process.id)}
                    onMouseEnter={() => prefetch(process.id)}
                    onFocus={() => prefetch(process.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        openProcess(process.id);
                      }
                    }}
                  >
                    {visibleColumns.map((column) => (
                      <td key={column}>
                        {column === "process" ? (
                          <div className={cn("v-stack min-w-48 gap-1")}>
                            <strong className={cn("font-mono text-sm")}>
                              {process.formatted_number}
                            </strong>
                            <span className={cn("truncate text-xs text-muted")}>
                              {process.process_class ?? "Classe não informada"}
                            </span>
                          </div>
                        ) : column === "parties" ? (
                          <div className={cn("max-w-72")}>
                            <PartiesSummary
                              parties={process.process_parties}
                              limit={density === "compact" ? 1 : 2}
                            />
                          </div>
                        ) : column === "phase" ? (
                          <PhaseBadge process={process} />
                        ) : column === "risk" ? (
                          <RiskBadge level={process.highest_risk_level} />
                        ) : column === "tribunal" ? (
                          <span className={cn("text-sm")}>
                            {process.tribunal ?? "Não informado"}
                          </span>
                        ) : column === "status" ? (
                          <DataStatusBadge status={process.datajud_status} />
                        ) : (
                          <span className={cn("whitespace-nowrap text-sm")}>
                            {formatDate(process.last_movement_at)}
                          </span>
                        )}
                      </td>
                    ))}
                    <td>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Abrir processo ${process.formatted_number}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          openProcess(process.id);
                        }}
                      >
                        <Ellipsis size={18} aria-hidden="true" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {processPage ? (
            <Pagination
              page={processPage.page}
              pageCount={processPage.total_pages}
              pageSize={processPage.page_size}
              total={processPage.total}
              label="processos"
              onPageChange={(next) => updateParams({ page: String(next) }, false)}
              onPageSizeChange={(size) => updateParams({ pageSize: String(size), page: "1" })}
            />
          ) : null}
          <p className={cn("text-xs text-muted")}>
            A ordenação é aplicada à página atual; filtros e paginação são processados pelo
            servidor.
          </p>
        </>
      )}

      <Drawer
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
        title="Filtros avançados"
        description="Combine critérios e aplique em uma única operação."
        footer={
          <>
            <Button onClick={() => setAdvancedDraft(defaultProcessFilters)}>Limpar</Button>
            <Button variant="primary" onClick={() => applyFilters(advancedDraft)}>
              Aplicar filtros
            </Button>
          </>
        }
      >
        <div className={cn("v-stack gap-5")}>
          <Field label="Classe processual" htmlFor="advanced-class">
            <Select
              id="advanced-class"
              value={advancedDraft.processClass}
              onChange={(event) =>
                setAdvancedDraft({ ...advancedDraft, processClass: event.target.value })
              }
            >
              <option value="">Todas</option>
              {(filtersQuery.data?.process_classes ?? []).map((option) => (
                <option key={option}>{option}</option>
              ))}
            </Select>
          </Field>
          <Field label="Tribunal" htmlFor="advanced-tribunal">
            <Select
              id="advanced-tribunal"
              value={advancedDraft.tribunal}
              onChange={(event) =>
                setAdvancedDraft({ ...advancedDraft, tribunal: event.target.value })
              }
            >
              <option value="">Todos</option>
              {(filtersQuery.data?.tribunals ?? []).map((option) => (
                <option key={option}>{option}</option>
              ))}
            </Select>
          </Field>
          <Field label="Órgão julgador" htmlFor="advanced-agency">
            <Select
              id="advanced-agency"
              value={advancedDraft.agency}
              onChange={(event) =>
                setAdvancedDraft({ ...advancedDraft, agency: event.target.value })
              }
            >
              <option value="">Todos</option>
              {(filtersQuery.data?.agencies ?? []).map((option) => (
                <option key={option}>{option}</option>
              ))}
            </Select>
          </Field>
          <Field label="Status dos dados" htmlFor="advanced-status">
            <Select
              id="advanced-status"
              value={advancedDraft.dataStatus}
              onChange={(event) =>
                setAdvancedDraft({ ...advancedDraft, dataStatus: event.target.value })
              }
            >
              <option value="">Todos</option>
              {(filtersQuery.data?.data_statuses ?? []).map((option) => (
                <option key={option} value={option}>
                  {statusLabel(option)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Risco" htmlFor="advanced-risk">
            <Select
              id="advanced-risk"
              value={advancedDraft.riskFilter}
              onChange={(event) =>
                setAdvancedDraft({ ...advancedDraft, riskFilter: event.target.value })
              }
            >
              <option value="todos">Todos</option>
              <option value="com_risco">Com risco</option>
              <option value="critico">Crítico</option>
              <option value="alto">Alto</option>
              <option value="medio">Médio</option>
              <option value="baixo">Baixo</option>
              <option value="sem_risco">Sem risco</option>
            </Select>
          </Field>
          <Field label="Parte no polo passivo" htmlFor="advanced-defendant">
            <Input
              id="advanced-defendant"
              value={advancedDraft.defendant}
              onChange={(event) =>
                setAdvancedDraft({ ...advancedDraft, defendant: event.target.value })
              }
            />
          </Field>
        </div>
      </Drawer>

      <Drawer
        open={controlsOpen}
        onOpenChange={setControlsOpen}
        title="Tabela e densidade"
        description="Escolha o volume e as informações visíveis."
      >
        <div className={cn("v-stack gap-6")}>
          <Field label="Densidade" htmlFor="table-density">
            <Select
              id="table-density"
              value={density}
              onChange={(event) => updateParams({ density: event.target.value })}
            >
              <option value="comfortable">Confortável</option>
              <option value="compact">Compacta</option>
            </Select>
          </Field>
          <fieldset className={cn("v-stack gap-3")}>
            <legend className={cn("text-sm font-semibold")}>Colunas visíveis</legend>
            {(Object.keys(columnLabels) as ColumnKey[]).map((column) => (
              <label key={column} className={cn("h-stack items-center gap-3 text-sm")}>
                <input
                  className={cn("size-4 accent-brand")}
                  type="checkbox"
                  checked={visibleColumns.includes(column)}
                  disabled={column === "process"}
                  onChange={() => toggleColumn(column)}
                />
                {columnLabels[column]}
              </label>
            ))}
          </fieldset>
        </div>
      </Drawer>

      <Dialog
        open={saveViewOpen}
        onOpenChange={setSaveViewOpen}
        title="Salvar visualização"
        description="Os filtros atuais ficarão disponíveis somente neste navegador."
        footer={
          <>
            <Button onClick={() => setSaveViewOpen(false)}>Cancelar</Button>
            <Button variant="primary" disabled={!viewName.trim()} onClick={saveView}>
              <Save size={16} aria-hidden="true" />
              Salvar
            </Button>
          </>
        }
      >
        <Field label="Nome" htmlFor="saved-view-name">
          <Input
            id="saved-view-name"
            autoFocus
            value={viewName}
            onChange={(event) => setViewName(event.target.value)}
          />
        </Field>
      </Dialog>
    </div>
  );
}
