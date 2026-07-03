import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CheckCircle2,
  Clock3,
  Cpu,
  Download,
  ExternalLink,
  FileDown,
  FileSpreadsheet,
  Gavel,
  ListFilter,
  Loader2,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  RotateCw,
  Save,
  Search,
  ServerCog,
  ShieldAlert,
  ShieldCheck,
  Square,
  Tags,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";

import {
  createClient,
  createRiskKeyword,
  createSearchRun,
  deleteClient,
  deleteRiskKeyword,
  enrichProcess,
  exportUrl,
  getProcess,
  getSearchRun,
  getWorkerDashboard,
  listClients,
  listProcessesPage,
  listRiskKeywords,
  reprocessRiskKeywords,
  startWorker,
  stopWorker,
  updateClient,
  updateRiskKeyword,
} from "./api";
import { cn } from "./lib/cn";
import type {
  Client,
  ClientPayload,
  Communication,
  ProcessDetail,
  ProcessEnrichment,
  ProcessListItem,
  ProcessParty,
  RiskKeyword,
  RiskKeywordPayload,
  RiskLevel,
  RiskMatch,
  RiskReprocess,
  SearchRun,
  WorkerDashboard,
  WorkerInstance,
  WorkerStartPayload,
} from "./types";

const navItems = [
  { to: "/", label: "Clientes", icon: Users },
  { to: "/processos", label: "Processos", icon: BriefcaseBusiness },
  { to: "/movimentacoes", label: "Movimentacoes", icon: Gavel },
  { to: "/riscos", label: "Riscos", icon: ShieldAlert },
  { to: "/workers", label: "Robos", icon: ServerCog },
  { to: "/exportacoes", label: "Exportacoes", icon: FileDown },
];

const riskLevelOptions: Array<{ value: RiskLevel; label: string }> = [
  { value: "baixo", label: "Baixo" },
  { value: "medio", label: "Medio" },
  { value: "alto", label: "Alto" },
  { value: "critico", label: "Critico" },
];

const pageSizeOptions = [5, 8, 9, 10, 20, 50];

type SearchPeriodPreset = "last_7" | "last_30" | "last_90" | "current_month" | "custom";

type MovementSearchOptions = {
  startDate: string;
  endDate: string;
  analyzeRisks: boolean;
  openMovementsWhenDone: boolean;
};

type MovementSearchForm = MovementSearchOptions & {
  preset: SearchPeriodPreset;
};

type RiskAutomationState = {
  runId: string | null;
  status: "idle" | "pending" | "running" | "completed" | "failed";
  result: RiskReprocess | null;
  error: string | null;
};

const searchPeriodOptions: Array<{ value: SearchPeriodPreset; label: string }> = [
  { value: "last_7", label: "Ultimos 7 dias" },
  { value: "last_30", label: "Ultimos 30 dias" },
  { value: "last_90", label: "Ultimos 90 dias" },
  { value: "current_month", label: "Mes atual" },
  { value: "custom", label: "Personalizado" },
];

const emptyWorkerDashboard: WorkerDashboard = {
  workers: [],
  active_workers: 0,
  working_workers: 0,
  idle_workers: 0,
  stale_workers: 0,
  queued_runs: 0,
  running_runs: 0,
  failed_runs: 0,
};

export default function App() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [activeSearchOptions, setActiveSearchOptions] = useState<MovementSearchOptions | null>(null);
  const [completionHandledRunId, setCompletionHandledRunId] = useState<string | null>(null);
  const [riskAutomation, setRiskAutomation] = useState<RiskAutomationState>({
    runId: null,
    status: "idle",
    result: null,
    error: null,
  });

  const clientsQuery = useQuery({ queryKey: ["clients"], queryFn: listClients });
  const clients = clientsQuery.data ?? [];

  function handleSelectClient(clientId: string | null) {
    setSelectedClientId(clientId);
    setSelectedProcessId(null);
  }

  useEffect(() => {
    if (!selectedClientId && clients.length > 0) {
      setSelectedClientId(clients[0].id);
    }
  }, [clients, selectedClientId]);

  const selectedClient = clients.find((client) => client.id === selectedClientId) ?? null;

  const runQuery = useQuery({
    queryKey: ["search-run", activeRunId],
    queryFn: () => getSearchRun(activeRunId!),
    enabled: Boolean(activeRunId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "running" ? 3000 : false;
    },
  });

  const riskAutomationMutation = useMutation({
    mutationFn: reprocessRiskKeywords,
    onSuccess: (result) => {
      setRiskAutomation((current) => ({
        ...current,
        status: "completed",
        result,
        error: null,
      }));
      queryClient.invalidateQueries({ queryKey: ["risk-keywords"] });
      queryClient.invalidateQueries({ queryKey: ["process"] });
      queryClient.invalidateQueries({ queryKey: ["processes"] });
      queryClient.invalidateQueries({ queryKey: ["processes-page"] });
    },
    onError: (error) => {
      setRiskAutomation((current) => ({
        ...current,
        status: "failed",
        error: error.message,
      }));
    },
  });

  useEffect(() => {
    const run = runQuery.data;
    if (!run || run.status !== "completed" || completionHandledRunId === run.id) {
      return;
    }

    setCompletionHandledRunId(run.id);
    queryClient.invalidateQueries({ queryKey: ["clients"] });
    queryClient.invalidateQueries({ queryKey: ["processes"] });
    queryClient.invalidateQueries({ queryKey: ["processes-page"] });

    if (activeSearchOptions?.openMovementsWhenDone) {
      navigate("/movimentacoes");
    }

    if (activeSearchOptions?.analyzeRisks) {
      setRiskAutomation({
        runId: run.id,
        status: "running",
        result: null,
        error: null,
      });
      riskAutomationMutation.mutate();
    }
  }, [
    activeSearchOptions,
    completionHandledRunId,
    navigate,
    queryClient,
    riskAutomationMutation,
    runQuery.data,
  ]);

  function handleRunCreated(runId: string, options: MovementSearchOptions) {
    setActiveRunId(runId);
    setActiveSearchOptions(options);
    setCompletionHandledRunId(null);
    setRiskAutomation({
      runId,
      status: options.analyzeRisks ? "pending" : "idle",
      result: null,
      error: null,
    });
  }

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="mx-auto grid min-h-screen max-w-7xl grid-rows-[auto_1fr] px-4 py-4 lg:px-6">
        <header className="v-stack min-w-0 gap-3 border-b border-line pb-4 lg:h-stack lg:flex-wrap lg:items-center">
          <div className="h-stack min-w-0 items-center gap-3">
            <div className="center h-10 w-10 shrink-0 rounded-md bg-ink text-white">
              <Gavel size={21} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold">JUDS</h1>
              <p className="truncate text-sm text-neutral-600">
                Gestao de processos e movimentacoes
              </p>
            </div>
          </div>
          <div className="hidden lg:block lg:spacer" />
          <nav className="h-stack min-w-0 max-w-full flex-wrap gap-2 pb-1 lg:w-auto" aria-label="Principal">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  cn("ui-tab h-stack items-center gap-2", {
                    "ui-tab-active": isActive,
                  })
                }
              >
                <item.icon size={17} aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </header>

        <Routes>
          <Route
            path="/"
            element={
              <ClientsView
                clients={clients}
                selectedClient={selectedClient}
                selectedClientId={selectedClientId}
                activeRun={runQuery.data ?? null}
                activeSearchOptions={activeSearchOptions}
                riskAutomation={riskAutomation}
                clientsLoading={clientsQuery.isLoading}
                onSelectClient={handleSelectClient}
                onRunCreated={handleRunCreated}
              />
            }
          />
          <Route
            path="/processos"
            element={
              <ProcessesView
                clients={clients}
                selectedClientId={selectedClientId}
                onSelectClient={handleSelectClient}
                selectedProcessId={selectedProcessId}
                onSelectProcess={setSelectedProcessId}
              />
            }
          />
          <Route
            path="/movimentacoes"
            element={
              <MovementsView
                selectedClient={selectedClient}
                selectedProcessId={selectedProcessId}
                onSelectProcess={setSelectedProcessId}
              />
            }
          />
          <Route path="/riscos" element={<RiskManagementView />} />
          <Route path="/workers" element={<WorkersView />} />
          <Route
            path="/exportacoes"
            element={
              <ExportsView
                clients={clients}
                selectedClientId={selectedClientId}
                onSelectClient={handleSelectClient}
              />
            }
          />
        </Routes>
      </div>
    </main>
  );
}

function ClientsView({
  clients,
  selectedClient,
  selectedClientId,
  activeRun,
  activeSearchOptions,
  riskAutomation,
  clientsLoading,
  onSelectClient,
  onRunCreated,
}: {
  clients: Client[];
  selectedClient: Client | null;
  selectedClientId: string | null;
  activeRun: SearchRun | null;
  activeSearchOptions: MovementSearchOptions | null;
  riskAutomation: RiskAutomationState;
  clientsLoading: boolean;
  onSelectClient: (clientId: string | null) => void;
  onRunCreated: (runId: string, options: MovementSearchOptions) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ClientPayload>(defaultClientForm);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ClientPayload>(defaultClientForm);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const clientPagination = usePaginatedItems(clients, 9);

  const createClientMutation = useMutation({
    mutationFn: createClient,
    onSuccess: (client) => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      onSelectClient(client.id);
      setForm(defaultClientForm());
    },
  });

  const updateClientMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<ClientPayload> }) =>
      updateClient(id, payload),
    onSuccess: (updatedClient) => {
      queryClient.setQueryData<Client[]>(["clients"], (current) =>
        current?.map((client) => (client.id === updatedClient.id ? updatedClient : client)),
      );
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      setEditingClientId(null);
    },
  });

  const deleteClientMutation = useMutation({
    mutationFn: deleteClient,
    onSuccess: (deletedClient) => {
      const remainingClients = clients.filter((client) => client.id !== deletedClient.id);
      queryClient.setQueryData<Client[]>(["clients"], remainingClients);
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["processes"] });
      queryClient.invalidateQueries({ queryKey: ["processes-page"] });
      if (selectedClientId === deletedClient.id) {
        onSelectClient(remainingClients[0]?.id ?? null);
      }
      setEditingClientId(null);
    },
  });

  const searchMutation = useMutation({
    mutationFn: ({
      clientId,
      options,
    }: {
      clientId: string;
      options: MovementSearchOptions;
    }) =>
      createSearchRun(clientId, {
        start_date: options.startDate,
        end_date: options.endDate,
      }),
    onSuccess: (run, variables) => {
      onRunCreated(run.id, variables.options);
      setSearchModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
  });

  function submitClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createClientMutation.mutate(normalizeClientPayload(form));
  }

  function startClientEdit(client: Client) {
    setEditingClientId(client.id);
    setEditForm({ name: client.name, cpf: "" });
  }

  function submitClientEdit(event: FormEvent<HTMLFormElement>, clientId: string) {
    event.preventDefault();
    updateClientMutation.mutate({
      id: clientId,
      payload: normalizeClientUpdatePayload(editForm),
    });
  }

  function confirmClientDelete(client: Client) {
    const confirmed = window.confirm(`Excluir o cliente "${client.name}"?`);
    if (confirmed) {
      deleteClientMutation.mutate(client.id);
    }
  }

  return (
    <section className="grid gap-4 py-5 lg:grid-cols-[minmax(320px,380px)_1fr]">
      <Panel title="Cliente" icon={<Users size={18} />}>
        <form className="v-stack gap-3" onSubmit={submitClient}>
          <ClientFields value={form} onChange={setForm} />
          <button className="ui-button ui-button-primary h-stack items-center gap-2" type="submit">
            {createClientMutation.isPending ? (
              <Loader2 className="animate-spin" size={17} aria-hidden="true" />
            ) : (
              <Users size={17} aria-hidden="true" />
            )}
            Cadastrar
          </button>
          <MutationError error={createClientMutation.error} />
        </form>

        <div className="v-stack gap-2 border-t border-line pt-4">
          <ClientSelect
            clients={clients}
            selectedClientId={selectedClientId}
            onSelectClient={onSelectClient}
          />
          <button
            className="ui-button h-stack items-center gap-2"
            type="button"
            disabled={!selectedClient || searchMutation.isPending}
            onClick={() => selectedClient && setSearchModalOpen(true)}
          >
            {searchMutation.isPending ? (
              <Loader2 className="animate-spin" size={17} aria-hidden="true" />
            ) : (
              <Search size={17} aria-hidden="true" />
            )}
            Buscar movimentacoes
          </button>
          <MutationError error={searchMutation.error} />
          <RunStatus
            run={activeRun}
            options={activeSearchOptions}
            riskAutomation={riskAutomation}
          />
        </div>
      </Panel>

      <Panel title="Carteira" icon={<BriefcaseBusiness size={18} />}>
        {clientsLoading ? (
          <LoadingState label="Carregando clientes" />
        ) : clients.length === 0 ? (
          <EmptyState label="Cadastre o primeiro cliente para iniciar as buscas." />
        ) : (
          <div className="v-stack gap-3">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {clientPagination.items.map((client) => {
                const isEditing = editingClientId === client.id;
                const isSelected = selectedClientId === client.id;
                return isEditing ? (
                  <form
                    key={client.id}
                    className={cn("ui-card v-stack gap-3", {
                      "ring-2 ring-brand-500": isSelected,
                    })}
                    onSubmit={(event) => submitClientEdit(event, client.id)}
                  >
                    <ClientFields
                      value={editForm}
                      onChange={setEditForm}
                      cpfPlaceholder={client.cpf_masked ?? "CPF opcional"}
                      cpfHint="Preencha somente se quiser alterar o CPF."
                    />
                    <div className="h-stack flex-wrap gap-2">
                      <button
                        className="ui-button ui-button-primary h-stack items-center gap-2"
                        type="submit"
                        disabled={updateClientMutation.isPending}
                      >
                        {updateClientMutation.isPending ? (
                          <Loader2 className="animate-spin" size={17} aria-hidden="true" />
                        ) : (
                          <Save size={17} aria-hidden="true" />
                        )}
                        Salvar
                      </button>
                      <button className="ui-button" type="button" onClick={() => setEditingClientId(null)}>
                        Cancelar
                      </button>
                    </div>
                    <MutationError error={updateClientMutation.error} />
                  </form>
                ) : (
                  <article
                    key={client.id}
                    className={cn("ui-card v-stack gap-3", {
                      "ring-2 ring-brand-500": isSelected,
                    })}
                  >
                    <div className="h-stack items-start gap-3">
                      <button
                        className="h-stack min-w-0 grow appearance-none items-start gap-3 border-0 bg-transparent p-0 text-left text-ink"
                        type="button"
                        onClick={() => onSelectClient(client.id)}
                      >
                        <div className="center h-9 w-9 shrink-0 rounded-md bg-brand-50 text-brand-700">
                          <Users size={17} aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{client.name}</p>
                          <p className="mt-1 text-xs text-neutral-600">
                            {client.cpf_masked ?? "CPF nao informado"}
                          </p>
                        </div>
                      </button>
                      <div className="h-stack shrink-0 gap-2">
                        <button
                          className="ui-icon-button"
                          type="button"
                          title="Editar cliente"
                          onClick={() => startClientEdit(client)}
                        >
                          <Pencil size={15} aria-hidden="true" />
                        </button>
                        <button
                          className="ui-icon-button text-danger hover:text-danger"
                          type="button"
                          title="Excluir cliente"
                          disabled={deleteClientMutation.isPending}
                          onClick={() => confirmClientDelete(client)}
                        >
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <Metric label="Processos" value={client.process_count} />
                      <Metric label="Movs." value={client.communication_count} />
                      <Metric label="Filas" value={client.pending_runs} />
                    </div>
                  </article>
                );
              })}
            </div>
            <PaginationControls
              page={clientPagination.page}
              pageCount={clientPagination.pageCount}
              pageSize={clientPagination.pageSize}
              totalItems={clientPagination.totalItems}
              itemLabel="clientes"
              onPageChange={clientPagination.setPage}
              onPageSizeChange={clientPagination.setPageSize}
            />
            <MutationError error={deleteClientMutation.error} />
          </div>
        )}
      </Panel>
      {searchModalOpen && selectedClient && (
        <MovementSearchModal
          client={selectedClient}
          isSubmitting={searchMutation.isPending}
          error={searchMutation.error}
          onClose={() => setSearchModalOpen(false)}
          onSubmit={(options) => searchMutation.mutate({ clientId: selectedClient.id, options })}
        />
      )}
    </section>
  );
}

function ProcessesView({
  clients,
  selectedClientId,
  selectedProcessId,
  onSelectClient,
  onSelectProcess,
}: {
  clients: Client[];
  selectedClientId: string | null;
  selectedProcessId: string | null;
  onSelectClient: (clientId: string | null) => void;
  onSelectProcess: (processId: string) => void;
}) {
  const navigate = useNavigate();
  const [riskFilter, setRiskFilter] = useState("todos");
  const [processPage, setProcessPage] = useState(1);
  const [processPageSize, setProcessPageSize] = useState(10);

  useEffect(() => {
    setProcessPage(1);
  }, [processPageSize, riskFilter, selectedClientId]);

  const processesQuery = useQuery({
    queryKey: ["processes-page", selectedClientId, riskFilter, processPage, processPageSize],
    queryFn: () =>
      listProcessesPage({
        clientId: selectedClientId,
        riskFilter,
        page: processPage,
        pageSize: processPageSize,
      }),
    enabled: Boolean(selectedClientId),
  });
  const processPageData = processesQuery.data ?? null;
  const processes = processPageData?.items ?? [];

  useEffect(() => {
    if (processPageData && processPage > processPageData.total_pages) {
      setProcessPage(processPageData.total_pages);
    }
  }, [processPage, processPageData]);

  const columns = useMemo<ColumnDef<ProcessListItem>[]>(
    () => [
      {
        header: "Processo",
        accessorKey: "formatted_number",
        cell: ({ row }) => (
          <div className="v-stack gap-1">
            <span className="font-medium">{row.original.formatted_number}</span>
            <span className="text-xs text-neutral-600">{row.original.process_class ?? "Classe ausente"}</span>
          </div>
        ),
      },
      {
        header: "Partes",
        accessorKey: "process_parties",
        cell: ({ row }) => <ProcessParties parties={row.original.process_parties} compact />,
      },
      {
        header: "Risco",
        accessorKey: "highest_risk_level",
        cell: ({ row }) => <ProcessRiskSummary process={row.original} compact />,
      },
      {
        header: "Tribunal",
        accessorKey: "tribunal",
        cell: ({ row }) => <Badge>{row.original.tribunal ?? "Sem tribunal"}</Badge>,
      },
      {
        header: "Dados",
        accessorKey: "datajud_status",
        cell: ({ row }) => <ProcessDataStatusBadge status={row.original.datajud_status} />,
      },
      {
        header: "Ultima",
        accessorKey: "last_movement_at",
        cell: ({ row }) => (
          <span className="text-sm">{formatDate(row.original.last_movement_at)}</span>
        ),
      },
      {
        header: "Movs.",
        accessorKey: "communications_count",
        cell: ({ row }) => <span className="font-medium">{row.original.communications_count}</span>,
      },
      {
        header: "",
        id: "action",
        cell: ({ row }) => (
          <button
            className="ui-icon-button"
            type="button"
            title="Abrir movimentacoes"
            onClick={() => {
              onSelectProcess(row.original.id);
              navigate("/movimentacoes");
            }}
          >
            <ArrowRight size={17} aria-hidden="true" />
          </button>
        ),
      },
    ],
    [navigate, onSelectProcess],
  );

  const table = useReactTable({
    data: processes,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <section className="v-stack gap-4 py-5">
      <Panel title="Processos" icon={<BriefcaseBusiness size={18} />}>
        <div className="h-stack flex-wrap items-end gap-3">
          <ClientSelect
            clients={clients}
            selectedClientId={selectedClientId}
            onSelectClient={onSelectClient}
          />
          <button
            className="ui-button h-stack items-center gap-2"
            type="button"
            onClick={() => processesQuery.refetch()}
            disabled={!selectedClientId || processesQuery.isFetching}
          >
            <RefreshCw
              className={cn({ "animate-spin": processesQuery.isFetching })}
              size={17}
              aria-hidden="true"
            />
            Atualizar
          </button>
          <label className="v-stack min-w-[220px] gap-1 text-sm font-medium">
            Filtro de risco
            <select className="ui-input" value={riskFilter} onChange={(event) => setRiskFilter(event.target.value)}>
              <option value="todos">Todos</option>
              <option value="com_risco">Com risco</option>
              <option value="critico">Critico</option>
              <option value="alto">Alto</option>
              <option value="medio">Medio</option>
              <option value="baixo">Baixo</option>
              <option value="sem_risco">Sem risco</option>
            </select>
          </label>
        </div>
      </Panel>

      <Panel title="Resultado" icon={<ListFilter size={18} />}>
        {processesQuery.isLoading ? (
          <LoadingState label="Carregando processos" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1160px] border-separate border-spacing-0 text-left text-sm">
              <thead>
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <th key={header.id} className="table-head">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className={cn("table-row", {
                      "bg-brand-50": selectedProcessId === row.original.id,
                    })}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="table-cell">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {processes.length === 0 && (
              <EmptyState label="Nenhum processo importado para o cliente selecionado." />
            )}
          </div>
        )}
        {processPageData && processPageData.total > 0 && (
          <PaginationControls
            page={processPageData.page}
            pageCount={processPageData.total_pages}
            pageSize={processPageData.page_size}
            totalItems={processPageData.total}
            itemLabel="processos"
            onPageChange={setProcessPage}
            onPageSizeChange={setProcessPageSize}
          />
        )}
      </Panel>
    </section>
  );
}

function MovementsView({
  selectedClient,
  selectedProcessId,
  onSelectProcess,
}: {
  selectedClient: Client | null;
  selectedProcessId: string | null;
  onSelectProcess: (processId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [typeFilter, setTypeFilter] = useState("");
  const [tribunalFilter, setTribunalFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [riskFilter, setRiskFilter] = useState("todos");
  const [enrichmentStartDate, setEnrichmentStartDate] = useState("");
  const [enrichmentEndDate, setEnrichmentEndDate] = useState("");
  const [lastEnrichment, setLastEnrichment] = useState<ProcessEnrichment | null>(null);
  const [processListPage, setProcessListPage] = useState(1);
  const [processListPageSize, setProcessListPageSize] = useState(10);

  const processesQuery = useQuery({
    queryKey: ["processes-page", "movements", selectedClient?.id, processListPage, processListPageSize],
    queryFn: () =>
      listProcessesPage({
        clientId: selectedClient?.id,
        riskFilter: "todos",
        page: processListPage,
        pageSize: processListPageSize,
      }),
    enabled: Boolean(selectedClient?.id),
  });
  const processListPageData = processesQuery.data ?? null;
  const processListItems = processListPageData?.items ?? [];

  useEffect(() => {
    setProcessListPage(1);
  }, [processListPageSize, selectedClient?.id]);

  useEffect(() => {
    if (processListPageData && processListPage > processListPageData.total_pages) {
      setProcessListPage(processListPageData.total_pages);
    }
  }, [processListPage, processListPageData]);

  useEffect(() => {
    if (!selectedProcessId && processListItems.length > 0) {
      onSelectProcess(processListItems[0].id);
    }
  }, [onSelectProcess, processListItems, selectedProcessId]);

  const detailQuery = useQuery({
    queryKey: ["process", selectedProcessId],
    queryFn: () => getProcess(selectedProcessId!),
    enabled: Boolean(selectedProcessId),
  });

  useEffect(() => {
    setLastEnrichment(null);
    setEnrichmentStartDate("");
    setEnrichmentEndDate("");
  }, [selectedProcessId]);

  const enrichMutation = useMutation({
    mutationFn: () =>
      enrichProcess(selectedProcessId!, {
        start_date: enrichmentStartDate || undefined,
        end_date: enrichmentEndDate || undefined,
        force_datajud: true,
    }),
    onSuccess: (result) => {
      setLastEnrichment(result);
      queryClient.setQueryData(["process", result.process.id], result.process);
      queryClient.invalidateQueries({ queryKey: ["processes"] });
      queryClient.invalidateQueries({ queryKey: ["processes-page"] });
      queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
  });

  const detail = detailQuery.data ?? null;
  const filteredTimeline = useMemo(() => {
    const timeline = detail?.timeline ?? [];
    return timeline.filter((communication) => {
      const byType = !typeFilter || communication.tipo_comunicacao === typeFilter;
      const byTribunal = !tribunalFilter || communication.sigla_tribunal === tribunalFilter;
      const byDate = !dateFilter || communication.data_disponibilizacao === dateFilter;
      const byRisk =
        riskFilter === "todos" ||
        (riskFilter === "com_risco" && communication.risk_matches.length > 0) ||
        (riskFilter === "sem_risco" && communication.risk_matches.length === 0) ||
        communication.risk_matches.some((match) => match.risk_level === riskFilter);
      return byType && byTribunal && byDate && byRisk;
    });
  }, [dateFilter, detail?.timeline, riskFilter, tribunalFilter, typeFilter]);
  const movementPagination = usePaginatedItems(filteredTimeline, 5);

  const typeOptions = uniqueOptions(detail?.timeline.map((item) => item.tipo_comunicacao));
  const tribunalOptions = uniqueOptions(detail?.timeline.map((item) => item.sigla_tribunal));
  const dateOptions = uniqueOptions(detail?.timeline.map((item) => item.data_disponibilizacao));

  return (
    <section className="grid gap-4 py-5 lg:grid-cols-[320px_1fr]">
      <Panel title="Processos" icon={<BriefcaseBusiness size={18} />}>
        <div className="v-stack gap-3">
          <div className="v-stack max-h-[calc(100vh-280px)] gap-2 overflow-y-auto pr-1">
            {processListItems.map((process) => (
              <button
                key={process.id}
                type="button"
                className={cn("ui-list-item v-stack gap-2 text-left", {
                  "border-brand-500 bg-brand-50": selectedProcessId === process.id,
                })}
                onClick={() => onSelectProcess(process.id)}
              >
                <span className="font-medium">{process.formatted_number}</span>
                <span className="text-xs text-neutral-600">{process.process_class ?? "Classe ausente"}</span>
                <ProcessParties parties={process.process_parties} compact />
                <div className="h-stack flex-wrap gap-2">
                  <Badge>{process.tribunal ?? "Tribunal ausente"}</Badge>
                  <ProcessDataStatusBadge status={process.datajud_status} />
                  <ProcessRiskSummary process={process} compact />
                </div>
              </button>
            ))}
            {processListItems.length === 0 && <EmptyState label="Nenhum processo disponivel." />}
          </div>
          {processListPageData && processListPageData.total > 0 && (
            <PaginationControls
              page={processListPageData.page}
              pageCount={processListPageData.total_pages}
              pageSize={processListPageData.page_size}
              totalItems={processListPageData.total}
              itemLabel="processos"
              onPageChange={setProcessListPage}
              onPageSizeChange={setProcessListPageSize}
            />
          )}
        </div>
      </Panel>

      <Panel title="Movimentacoes" icon={<Gavel size={18} />}>
        {detailQuery.isLoading ? (
          <LoadingState label="Carregando movimentacoes" />
        ) : detail ? (
          <div className="v-stack gap-4">
            <ProcessSummary detail={detail} />
            <ProcessInformationPanel
              detail={detail}
              enrichmentStartDate={enrichmentStartDate}
              enrichmentEndDate={enrichmentEndDate}
              lastEnrichment={lastEnrichment}
              isEnriching={enrichMutation.isPending}
              enrichError={enrichMutation.error}
              onEnrichmentStartDateChange={setEnrichmentStartDate}
              onEnrichmentEndDateChange={setEnrichmentEndDate}
              onEnrich={() => selectedProcessId && enrichMutation.mutate()}
            />
            <ComplementaryMovements detail={detail} />
            <div className="grid gap-3 md:grid-cols-4">
              <SelectFilter label="Tipo" value={typeFilter} options={typeOptions} onChange={setTypeFilter} />
              <SelectFilter
                label="Tribunal"
                value={tribunalFilter}
                options={tribunalOptions}
                onChange={setTribunalFilter}
              />
              <SelectFilter label="Data" value={dateFilter} options={dateOptions} onChange={setDateFilter} />
              <RiskFilter value={riskFilter} onChange={setRiskFilter} />
            </div>
            <div className="v-stack gap-3">
              <div className="h-stack flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">Movimentacoes</h3>
                <Badge>{filteredTimeline.length}</Badge>
              </div>
              {movementPagination.items.map((communication) => (
                <TimelineItem
                  key={communication.id}
                  communication={communication}
                  terms={highlightTerms(detail, selectedClient)}
                />
              ))}
              {filteredTimeline.length === 0 && <EmptyState label="Nenhuma movimentacao neste filtro." />}
              {filteredTimeline.length > 0 && (
                <PaginationControls
                  page={movementPagination.page}
                  pageCount={movementPagination.pageCount}
                  pageSize={movementPagination.pageSize}
                  totalItems={movementPagination.totalItems}
                  itemLabel="movimentacoes"
                  onPageChange={movementPagination.setPage}
                  onPageSizeChange={movementPagination.setPageSize}
                />
              )}
            </div>
          </div>
        ) : (
          <EmptyState label="Selecione um processo para ver a timeline." />
        )}
      </Panel>
    </section>
  );
}

function RiskManagementView() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<RiskKeywordPayload>(defaultRiskForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<RiskKeywordPayload>(defaultRiskForm);
  const [lastReprocess, setLastReprocess] = useState<RiskReprocess | null>(null);

  const keywordsQuery = useQuery({ queryKey: ["risk-keywords"], queryFn: listRiskKeywords });
  const keywords = keywordsQuery.data ?? [];
  const activeCount = keywords.filter((keyword) => keyword.active).length;
  const totalMatches = keywords.reduce((total, keyword) => total + keyword.match_count, 0);
  const keywordPagination = usePaginatedItems(keywords, 8);

  function invalidateRiskData() {
    queryClient.invalidateQueries({ queryKey: ["risk-keywords"] });
    queryClient.invalidateQueries({ queryKey: ["processes"] });
    queryClient.invalidateQueries({ queryKey: ["processes-page"] });
    queryClient.invalidateQueries({ queryKey: ["process"] });
  }

  const createMutation = useMutation({
    mutationFn: createRiskKeyword,
    onSuccess: (result) => {
      setForm(defaultRiskForm());
      setLastReprocess(result.reprocess);
      invalidateRiskData();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: RiskKeywordPayload }) =>
      updateRiskKeyword(id, payload),
    onSuccess: (result) => {
      setEditingId(null);
      setLastReprocess(result.reprocess);
      invalidateRiskData();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteRiskKeyword,
    onSuccess: (result) => {
      setEditingId(null);
      setLastReprocess(result.reprocess);
      invalidateRiskData();
    },
  });

  const reprocessMutation = useMutation({
    mutationFn: reprocessRiskKeywords,
    onSuccess: (result) => {
      setLastReprocess(result);
      invalidateRiskData();
    },
  });

  function submitNewKeyword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createMutation.mutate(normalizeRiskPayload(form));
  }

  function startEdit(keyword: RiskKeyword) {
    setEditingId(keyword.id);
    setEditForm({
      term: keyword.term,
      category: keyword.category,
      risk_level: keyword.risk_level,
      description: keyword.description ?? "",
      active: keyword.active,
    });
  }

  function submitEdit(event: FormEvent<HTMLFormElement>, keywordId: string) {
    event.preventDefault();
    updateMutation.mutate({ id: keywordId, payload: normalizeRiskPayload(editForm) });
  }

  return (
    <section className="grid gap-4 py-5 xl:grid-cols-[minmax(320px,420px)_1fr]">
      <Panel title="Nova palavra de risco" icon={<ShieldAlert size={18} />}>
        <form className="v-stack gap-3" onSubmit={submitNewKeyword}>
          <RiskKeywordFields value={form} onChange={setForm} />
          <button
            className="ui-button ui-button-primary h-stack items-center gap-2"
            type="submit"
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? (
              <Loader2 className="animate-spin" size={17} aria-hidden="true" />
            ) : (
              <Plus size={17} aria-hidden="true" />
            )}
            Cadastrar e reprocessar
          </button>
          <MutationError error={createMutation.error} />
        </form>

        <div className="grid gap-2 border-t border-line pt-4 sm:grid-cols-3">
          <Metric label="Ativas" value={activeCount} />
          <Metric label="Termos" value={keywords.length} />
          <Metric label="Evidencias" value={totalMatches} />
        </div>

        <div className="v-stack gap-3 border-t border-line pt-4">
          <button
            className="ui-button h-stack items-center gap-2"
            type="button"
            disabled={reprocessMutation.isPending}
            onClick={() => reprocessMutation.mutate()}
          >
            {reprocessMutation.isPending ? (
              <Loader2 className="animate-spin" size={17} aria-hidden="true" />
            ) : (
              <RotateCw size={17} aria-hidden="true" />
            )}
            Reprocessar movimentacoes
          </button>
          <MutationError error={reprocessMutation.error} />
          {lastReprocess && <RiskReprocessSummary result={lastReprocess} />}
        </div>
      </Panel>

      <Panel title="Palavras configuradas" icon={<Tags size={18} />}>
        {keywordsQuery.isLoading ? (
          <LoadingState label="Carregando palavras de risco" />
        ) : keywords.length === 0 ? (
          <EmptyState label="Cadastre a primeira palavra para classificar movimentacoes." />
        ) : (
          <div className="v-stack gap-3">
            {keywordPagination.items.map((keyword) => {
              const isEditing = editingId === keyword.id;
              return (
                <article key={keyword.id} className="ui-list-item v-stack gap-3">
                  {isEditing ? (
                    <form className="v-stack gap-3" onSubmit={(event) => submitEdit(event, keyword.id)}>
                      <RiskKeywordFields value={editForm} onChange={setEditForm} />
                      <div className="h-stack flex-wrap gap-2">
                        <button
                          className="ui-button ui-button-primary h-stack items-center gap-2"
                          type="submit"
                          disabled={updateMutation.isPending}
                        >
                          {updateMutation.isPending ? (
                            <Loader2 className="animate-spin" size={17} aria-hidden="true" />
                          ) : (
                            <Save size={17} aria-hidden="true" />
                          )}
                          Salvar
                        </button>
                        <button className="ui-button" type="button" onClick={() => setEditingId(null)}>
                          Cancelar
                        </button>
                      </div>
                      <MutationError error={updateMutation.error} />
                    </form>
                  ) : (
                    <>
                      <div className="h-stack flex-wrap items-start gap-3">
                        <div className="min-w-0 grow">
                          <div className="h-stack flex-wrap items-center gap-2">
                            <span className="break-words text-base font-semibold">{keyword.term}</span>
                            <RiskLevelBadge level={keyword.risk_level} />
                            <Badge>{keyword.category}</Badge>
                            {keyword.active ? (
                              <span className="h-stack items-center gap-1 text-xs font-semibold text-success">
                                <ShieldCheck size={14} aria-hidden="true" />
                                Ativa
                              </span>
                            ) : (
                              <span className="text-xs font-semibold text-neutral-500">Inativa</span>
                            )}
                          </div>
                          {keyword.description && (
                            <p className="mt-2 text-sm leading-6 text-neutral-700">{keyword.description}</p>
                          )}
                        </div>
                        <div className="h-stack shrink-0 gap-2">
                          <button className="ui-button" type="button" onClick={() => startEdit(keyword)}>
                            Editar
                          </button>
                          <button
                            className="ui-icon-button text-danger hover:text-danger"
                            type="button"
                            title="Excluir palavra"
                            disabled={deleteMutation.isPending}
                            onClick={() => deleteMutation.mutate(keyword.id)}
                          >
                            <Trash2 size={16} aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                      <div className="h-stack flex-wrap gap-2 text-xs text-neutral-600">
                        <Badge>{keyword.match_count} evidencias</Badge>
                        <span>Atualizada em {formatDateTime(keyword.updated_at)}</span>
                      </div>
                    </>
                  )}
                </article>
              );
            })}
            <PaginationControls
              page={keywordPagination.page}
              pageCount={keywordPagination.pageCount}
              pageSize={keywordPagination.pageSize}
              totalItems={keywordPagination.totalItems}
              itemLabel="riscos"
              onPageChange={keywordPagination.setPage}
              onPageSizeChange={keywordPagination.setPageSize}
            />
          </div>
        )}
      </Panel>
    </section>
  );
}

function WorkersView() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<WorkerStartPayload>(defaultWorkerForm);
  const workersQuery = useQuery({
    queryKey: ["workers"],
    queryFn: getWorkerDashboard,
    refetchInterval: 3000,
  });
  const dashboard = workersQuery.data ?? emptyWorkerDashboard;

  const startMutation = useMutation({
    mutationFn: startWorker,
    onSuccess: () => {
      setForm(defaultWorkerForm());
      queryClient.invalidateQueries({ queryKey: ["workers"] });
    },
  });

  const stopMutation = useMutation({
    mutationFn: stopWorker,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workers"] });
    },
  });

  function submitWorker(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startMutation.mutate(normalizeWorkerPayload(form));
  }

  return (
    <section className="grid gap-4 py-5 xl:grid-cols-[minmax(320px,420px)_1fr]">
      <Panel title="Controle" icon={<ServerCog size={18} />}>
        <form className="v-stack gap-3" onSubmit={submitWorker}>
          <label className="v-stack gap-1 text-sm font-medium">
            Nome
            <input
              className="ui-input"
              value={form.name ?? ""}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              minLength={2}
              maxLength={120}
              placeholder="robo-juridico-01"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="v-stack gap-1 text-sm font-medium">
              Intervalo
              <select
                className="ui-input"
                value={form.poll_interval_seconds}
                onChange={(event) =>
                  setForm({ ...form, poll_interval_seconds: Number(event.target.value) })
                }
              >
                <option value={1}>1 segundo</option>
                <option value={3}>3 segundos</option>
                <option value={5}>5 segundos</option>
                <option value={10}>10 segundos</option>
                <option value={30}>30 segundos</option>
              </select>
            </label>
            <label className="v-stack gap-1 text-sm font-medium">
              Modo
              <select
                className="ui-input"
                value={form.max_jobs ?? "continuous"}
                onChange={(event) =>
                  setForm({
                    ...form,
                    max_jobs: event.target.value === "continuous" ? null : Number(event.target.value),
                  })
                }
              >
                <option value="continuous">Continuo</option>
                <option value={1}>Uma busca</option>
                <option value={3}>Tres buscas</option>
              </select>
            </label>
          </div>
          <button
            className="ui-button ui-button-primary h-stack items-center gap-2"
            type="submit"
            disabled={startMutation.isPending}
          >
            {startMutation.isPending ? (
              <Loader2 className="animate-spin" size={17} aria-hidden="true" />
            ) : (
              <Power size={17} aria-hidden="true" />
            )}
            Iniciar robo
          </button>
          <MutationError error={startMutation.error} />
        </form>

        <WorkerQueueSummary dashboard={dashboard} />
      </Panel>

      <Panel title="Robos em execucao" icon={<Cpu size={18} />}>
        <div className="h-stack flex-wrap items-center gap-2">
          <button
            className="ui-button h-stack items-center gap-2"
            type="button"
            onClick={() => workersQuery.refetch()}
            disabled={workersQuery.isFetching}
          >
            <RefreshCw
              className={cn({ "animate-spin": workersQuery.isFetching })}
              size={17}
              aria-hidden="true"
            />
            Atualizar
          </button>
          <WorkerStatusBadge status="working" label={`${dashboard.working_workers} trabalhando`} />
          <WorkerStatusBadge status="idle" label={`${dashboard.idle_workers} aguardando`} />
          {dashboard.stale_workers > 0 && (
            <WorkerStatusBadge status="stale" label={`${dashboard.stale_workers} sem sinal`} />
          )}
        </div>

        {workersQuery.isLoading ? (
          <LoadingState label="Carregando robos" />
        ) : dashboard.workers.length === 0 ? (
          <EmptyState label="Nenhum robo registrado." />
        ) : (
          <div className="grid gap-3 2xl:grid-cols-2">
            {dashboard.workers.map((worker) => (
              <WorkerCard
                key={worker.id}
                worker={worker}
                isStopping={stopMutation.isPending}
                onStop={() => stopMutation.mutate(worker.id)}
              />
            ))}
          </div>
        )}
        <MutationError error={stopMutation.error} />
      </Panel>
    </section>
  );
}

function ExportsView({
  clients,
  selectedClientId,
  onSelectClient,
}: {
  clients: Client[];
  selectedClientId: string | null;
  onSelectClient: (clientId: string | null) => void;
}) {
  return (
    <section className="grid gap-4 py-5 lg:grid-cols-[minmax(320px,420px)_1fr]">
      <Panel title="Cliente" icon={<Users size={18} />}>
        <ClientSelect
          clients={clients}
          selectedClientId={selectedClientId}
          onSelectClient={onSelectClient}
        />
      </Panel>
      <Panel title="Arquivos" icon={<Download size={18} />}>
        <div className="h-stack flex-wrap gap-3">
          <a
            className={cn("ui-button h-stack items-center gap-2", {
              "pointer-events-none opacity-50": !selectedClientId,
            })}
            href={selectedClientId ? exportUrl(selectedClientId, "csv") : "#"}
          >
            <FileDown size={17} aria-hidden="true" />
            CSV
          </a>
          <a
            className={cn("ui-button h-stack items-center gap-2", {
              "pointer-events-none opacity-50": !selectedClientId,
            })}
            href={selectedClientId ? exportUrl(selectedClientId, "xlsx") : "#"}
          >
            <FileSpreadsheet size={17} aria-hidden="true" />
            XLSX
          </a>
        </div>
      </Panel>
    </section>
  );
}

function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="ui-panel v-stack min-w-0 gap-4">
      <div className="h-stack items-center gap-2">
        <span className="text-brand-700">{icon}</span>
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function ClientSelect({
  clients,
  selectedClientId,
  onSelectClient,
}: {
  clients: Client[];
  selectedClientId: string | null;
  onSelectClient: (clientId: string | null) => void;
}) {
  return (
    <label className="v-stack min-w-[260px] gap-1 text-sm font-medium">
      Cliente
      <select
        className="ui-input"
        value={selectedClientId ?? ""}
        onChange={(event) => onSelectClient(event.target.value || null)}
        disabled={clients.length === 0}
      >
        <option value="" disabled>
          Selecione
        </option>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function MovementSearchModal({
  client,
  isSubmitting,
  error,
  onClose,
  onSubmit,
}: {
  client: Client;
  isSubmitting: boolean;
  error: Error | null;
  onClose: () => void;
  onSubmit: (options: MovementSearchOptions) => void;
}) {
  const [form, setForm] = useState<MovementSearchForm>(defaultMovementSearchForm);
  const periodError = movementSearchPeriodError(form);
  const periodDays = movementSearchPeriodDays(form);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isSubmitting) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSubmitting, onClose]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!periodError) {
      onSubmit(normalizeMovementSearchOptions(form));
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 bg-ink/40 px-4 py-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="movement-search-title"
    >
      <div className="mx-auto max-h-[calc(100dvh-2rem)] max-w-3xl overflow-y-auto rounded-md border border-line bg-white shadow-subtle">
        <form className="v-stack gap-5 p-4 sm:p-5" onSubmit={submitSearch}>
          <div className="h-stack items-start gap-3">
            <div className="center h-10 w-10 shrink-0 rounded-md bg-brand-50 text-brand-700">
              <Search size={19} aria-hidden="true" />
            </div>
            <div className="min-w-0 grow">
              <h2 id="movement-search-title" className="text-lg font-semibold">Buscar movimentacoes</h2>
              <p className="mt-1 truncate text-sm text-neutral-600">{client.name}</p>
            </div>
            <button
              className="ui-icon-button shrink-0"
              type="button"
              title="Fechar"
              disabled={isSubmitting}
              onClick={onClose}
            >
              <X size={17} aria-hidden="true" />
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr]">
            <label className="v-stack gap-1 text-sm font-medium">
              Periodo
              <select
                className="ui-input"
                value={form.preset}
                onChange={(event) =>
                  setForm(searchFormForPreset(event.target.value as SearchPeriodPreset, form))
                }
              >
                {searchPeriodOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="v-stack gap-1 text-sm font-medium">
              Inicio
              <input
                className="ui-input"
                type="date"
                value={form.startDate}
                onChange={(event) =>
                  setForm({ ...form, preset: "custom", startDate: event.target.value })
                }
                required
              />
            </label>
            <label className="v-stack gap-1 text-sm font-medium">
              Fim
              <input
                className="ui-input"
                type="date"
                value={form.endDate}
                onChange={(event) =>
                  setForm({ ...form, preset: "custom", endDate: event.target.value })
                }
                required
              />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="ui-list-item h-stack cursor-pointer items-start gap-3">
              <input
                className="mt-1 h-4 w-4 accent-brand-600"
                type="checkbox"
                checked={form.analyzeRisks}
                onChange={(event) => setForm({ ...form, analyzeRisks: event.target.checked })}
              />
              <span className="v-stack gap-1">
                <span className="text-sm font-semibold">Analisar riscos ao concluir</span>
                <span className="text-xs leading-5 text-neutral-600">
                  Reprocessa palavras ativas apos a importacao.
                </span>
              </span>
            </label>
            <label className="ui-list-item h-stack cursor-pointer items-start gap-3">
              <input
                className="mt-1 h-4 w-4 accent-brand-600"
                type="checkbox"
                checked={form.openMovementsWhenDone}
                onChange={(event) => setForm({ ...form, openMovementsWhenDone: event.target.checked })}
              />
              <span className="v-stack gap-1">
                <span className="text-sm font-semibold">Abrir movimentacoes ao concluir</span>
                <span className="text-xs leading-5 text-neutral-600">
                  Direciona para a timeline depois da busca.
                </span>
              </span>
            </label>
          </div>

          <div className="grid gap-2 rounded-md border border-line bg-neutral-50 p-3 sm:grid-cols-3">
            <Metric label="Janela" value={`${periodDays} dia${periodDays === 1 ? "" : "s"}`} />
            <Metric label="Inicio" value={formatDate(form.startDate)} />
            <Metric label="Fim" value={formatDate(form.endDate)} />
          </div>

          {periodError && <p className="text-sm text-danger">{periodError}</p>}
          <MutationError error={error} />

          <div className="h-stack flex-wrap justify-end gap-2 border-t border-line pt-4">
            <button className="ui-button" type="button" disabled={isSubmitting} onClick={onClose}>
              Cancelar
            </button>
            <button
              className="ui-button ui-button-primary h-stack items-center gap-2"
              type="submit"
              disabled={isSubmitting || Boolean(periodError)}
            >
              {isSubmitting ? (
                <Loader2 className="animate-spin" size={17} aria-hidden="true" />
              ) : (
                <Search size={17} aria-hidden="true" />
              )}
              Iniciar busca
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ClientFields({
  value,
  onChange,
  cpfPlaceholder = "000.000.000-00",
  cpfHint = "Opcional.",
}: {
  value: ClientPayload;
  onChange: (value: ClientPayload) => void;
  cpfPlaceholder?: string;
  cpfHint?: string;
}) {
  return (
    <>
      <label className="v-stack gap-1 text-sm font-medium">
        Nome
        <input
          className="ui-input"
          value={value.name}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
          minLength={3}
          maxLength={255}
          required
          autoComplete="name"
        />
      </label>
      <label className="v-stack gap-1 text-sm font-medium">
        CPF
        <input
          className="ui-input"
          value={value.cpf ?? ""}
          onChange={(event) => onChange({ ...value, cpf: event.target.value })}
          maxLength={32}
          inputMode="numeric"
          placeholder={cpfPlaceholder}
        />
        <span className="text-xs font-normal text-neutral-500">{cpfHint}</span>
      </label>
    </>
  );
}

function RiskKeywordFields({
  value,
  onChange,
}: {
  value: RiskKeywordPayload;
  onChange: (value: RiskKeywordPayload) => void;
}) {
  return (
    <>
      <label className="v-stack gap-1 text-sm font-medium">
        Palavra-chave
        <input
          className="ui-input"
          value={value.term}
          onChange={(event) => onChange({ ...value, term: event.target.value })}
          minLength={2}
          maxLength={255}
          required
          placeholder="sisbajud, penhora, Banco do Brasil"
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="v-stack gap-1 text-sm font-medium">
          Categoria
          <input
            className="ui-input"
            list="risk-category-options"
            value={value.category}
            onChange={(event) => onChange({ ...value, category: event.target.value })}
            minLength={2}
            maxLength={80}
            required
          />
        </label>
        <RiskLevelSelect
          value={value.risk_level}
          onChange={(riskLevel) => onChange({ ...value, risk_level: riskLevel })}
        />
      </div>
      <datalist id="risk-category-options">
        <option value="Bloqueio judicial" />
        <option value="Instituicao financeira" />
        <option value="Garantias" />
        <option value="Prazo critico" />
        <option value="Geral" />
      </datalist>
      <label className="v-stack gap-1 text-sm font-medium">
        Observacao
        <textarea
          className="ui-input min-h-24 resize-y"
          value={value.description ?? ""}
          onChange={(event) => onChange({ ...value, description: event.target.value })}
          maxLength={1000}
        />
      </label>
      <label className="h-stack items-center gap-2 text-sm font-medium">
        <input
          className="h-4 w-4 accent-brand-600"
          type="checkbox"
          checked={value.active}
          onChange={(event) => onChange({ ...value, active: event.target.checked })}
        />
        Incluir nas proximas verificacoes
      </label>
    </>
  );
}

function RiskLevelSelect({
  value,
  onChange,
}: {
  value: RiskLevel;
  onChange: (value: RiskLevel) => void;
}) {
  return (
    <label className="v-stack gap-1 text-sm font-medium">
      Nivel
      <select className="ui-input" value={value} onChange={(event) => onChange(event.target.value as RiskLevel)}>
        {riskLevelOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function RiskFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="v-stack gap-1 text-sm font-medium">
      Risco
      <select className="ui-input" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="todos">Todos</option>
        <option value="com_risco">Com risco</option>
        <option value="critico">Critico</option>
        <option value="alto">Alto</option>
        <option value="medio">Medio</option>
        <option value="baixo">Baixo</option>
        <option value="sem_risco">Sem risco</option>
      </select>
    </label>
  );
}

function RunStatus({
  run,
  options,
  riskAutomation,
}: {
  run: SearchRun | null;
  options: MovementSearchOptions | null;
  riskAutomation: RiskAutomationState;
}) {
  if (!run) {
    return null;
  }
  const isWorking = run.status === "queued" || run.status === "running";
  const isWaitingForAvailability = isWorking && run.rate_limit_remaining === 0;
  const shouldShowError = Boolean(run.error_message) && run.status !== "completed" && !isWaitingForAvailability;
  const showRiskAutomation = options?.analyzeRisks && riskAutomation.runId === run.id;
  return (
    <div className="rounded-md border border-line bg-white p-3 text-sm">
      <div className="h-stack items-center gap-2">
        {isWorking ? (
          <Clock3 size={17} className="text-warning" aria-hidden="true" />
        ) : run.status === "completed" ? (
          <CheckCircle2 size={17} className="text-success" aria-hidden="true" />
        ) : (
          <AlertTriangle size={17} className="text-danger" aria-hidden="true" />
        )}
        <span className="font-medium">{statusLabel(run.status)}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-neutral-700">
        <span>Importadas: {run.total_imported}</span>
        <span>Data: {formatDate(run.current_date)}</span>
      </div>
      {options && (
        <div className="mt-2 grid gap-2 border-t border-line pt-2 text-xs text-neutral-600 sm:grid-cols-2">
          <span>
            Periodo: {formatDate(options.startDate)} - {formatDate(options.endDate)}
          </span>
          <span>Riscos: {options.analyzeRisks ? riskAutomationLabel(riskAutomation) : "Sem reprocessamento"}</span>
        </div>
      )}
      {showRiskAutomation && riskAutomation.result && (
        <div className="mt-2 grid gap-2 rounded-md border border-line bg-neutral-50 p-2 text-xs sm:grid-cols-3">
          <Metric label="Lidas" value={riskAutomation.result.scanned_communications} />
          <Metric label="Com risco" value={riskAutomation.result.matched_communications} />
          <Metric label="Evidencias" value={riskAutomation.result.matches_created} />
        </div>
      )}
      {showRiskAutomation && riskAutomation.error && (
        <p className="mt-2 text-danger">{riskAutomation.error}</p>
      )}
      {isWaitingForAvailability && (
        <p className="mt-2 text-warning">Aguardando disponibilidade da consulta para continuar automaticamente.</p>
      )}
      {shouldShowError && (
        <p className="mt-2 text-danger">{run.error_message}</p>
      )}
    </div>
  );
}

function ProcessSummary({ detail }: { detail: ProcessDetail }) {
  return (
    <div className="grid gap-3 border-b border-line pb-4 md:grid-cols-4">
      <Metric label="Processo" value={detail.formatted_number} wide />
      <Metric label="Tribunal" value={detail.tribunal ?? "Ausente"} />
      <Metric label="Movs." value={detail.communications_count} />
      <Metric label="Ultima" value={formatDate(detail.last_movement_at)} />
      <div className="v-stack gap-2 md:col-span-4">
        <ProcessParties parties={detail.process_parties} />
        <ProcessRiskSummary process={detail} />
        <div className="h-stack flex-wrap gap-2">
          {detail.external_link && (
            <a
              className="ui-link h-stack items-center gap-1"
              href={detail.external_link}
              target="_blank"
              rel="noreferrer noopener"
            >
              Inteiro teor
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          )}
        </div>
        <RiskEvidenceList matches={detail.risk_matches} compact />
      </div>
    </div>
  );
}

function ProcessInformationPanel({
  detail,
  enrichmentStartDate,
  enrichmentEndDate,
  lastEnrichment,
  isEnriching,
  enrichError,
  onEnrichmentStartDateChange,
  onEnrichmentEndDateChange,
  onEnrich,
}: {
  detail: ProcessDetail;
  enrichmentStartDate: string;
  enrichmentEndDate: string;
  lastEnrichment: ProcessEnrichment | null;
  isEnriching: boolean;
  enrichError: Error | null;
  onEnrichmentStartDateChange: (value: string) => void;
  onEnrichmentEndDateChange: (value: string) => void;
  onEnrich: () => void;
}) {
  const complementary = detail.datajud;
  return (
    <div className="v-stack gap-3 border-b border-line pb-4">
      <div className="v-stack gap-3 xl:h-stack xl:items-end">
        <div className="v-stack min-w-0 grow gap-2">
          <div className="h-stack flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">Informacoes do processo</h3>
            <ProcessDataStatusBadge status={complementary.status} />
            <span className="text-xs text-neutral-600">Atualizado: {formatDateTime(complementary.synced_at)}</span>
          </div>
          {lastEnrichment && (
            <div className="h-stack flex-wrap gap-2 text-xs text-neutral-700">
              <Badge>Encontradas {lastEnrichment.djen_items_found}</Badge>
              <Badge>Novas {lastEnrichment.djen_imported}</Badge>
              <Badge>Paginas {lastEnrichment.djen_pages}</Badge>
              <span>
                {formatDate(lastEnrichment.start_date)} - {formatDate(lastEnrichment.end_date)}
              </span>
            </div>
          )}
        </div>
        <div className="h-stack flex-wrap items-end gap-2">
          <label className="v-stack gap-1 text-xs font-medium text-neutral-600">
            Inicio
            <input
              className="ui-input w-36"
              type="date"
              value={enrichmentStartDate}
              onChange={(event) => onEnrichmentStartDateChange(event.target.value)}
            />
          </label>
          <label className="v-stack gap-1 text-xs font-medium text-neutral-600">
            Fim
            <input
              className="ui-input w-36"
              type="date"
              value={enrichmentEndDate}
              onChange={(event) => onEnrichmentEndDateChange(event.target.value)}
            />
          </label>
          <button
            className="ui-button ui-button-primary h-stack items-center gap-2"
            type="button"
            disabled={isEnriching}
            onClick={onEnrich}
          >
            {isEnriching ? (
              <Loader2 className="animate-spin" size={17} aria-hidden="true" />
            ) : (
              <RefreshCw size={17} aria-hidden="true" />
            )}
            Atualizar dados
          </button>
        </div>
      </div>
      <MutationError error={enrichError} />
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Classe" value={detail.process_class ?? "Ausente"} />
        <Metric label="Orgao" value={detail.agency ?? "Ausente"} />
        <Metric label="Ajuizamento" value={formatDate(complementary.filed_at)} />
        <Metric label="Ultima Mov." value={formatDateTime(complementary.last_movement_at)} />
        <Metric label="Grau" value={complementary.degree ?? "Ausente"} />
        <Metric label="Sigilo" value={complementary.secrecy_level ?? "Ausente"} />
        <Metric label="Sistema" value={complementary.system ?? "Ausente"} />
        <Metric label="Formato" value={complementary.format ?? "Ausente"} />
        <Metric label="Atualizacao" value={formatDateTime(complementary.source_updated_at)} />
        <Metric label="Movs. complementares" value={complementary.movements_count} />
      </div>
      {complementary.subjects.length > 0 && (
        <div className="h-stack flex-wrap gap-2">
          {complementary.subjects.map((subject) => (
            <Badge key={subject}>{subject}</Badge>
          ))}
        </div>
      )}
      {complementary.error && <p className="text-sm text-danger">{complementary.error}</p>}
    </div>
  );
}

function ComplementaryMovements({ detail }: { detail: ProcessDetail }) {
  const movements = detail.datajud.movements;
  if (movements.length === 0) {
    return null;
  }
  return (
    <div className="v-stack gap-3 border-b border-line pb-4">
      <div className="h-stack flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Historico complementar</h3>
        <Badge>{movements.length}</Badge>
      </div>
      <div className="v-stack max-h-80 gap-2 overflow-y-auto pr-1">
        {movements.map((movement, index) => (
          <article
            key={`${movement.codigo ?? "sem-codigo"}-${movement.data_hora ?? index}`}
            className="ui-list-item v-stack gap-2"
          >
            <div className="h-stack flex-wrap items-center gap-2">
              <Badge>{movement.codigo ?? "Sem codigo"}</Badge>
              <span className="text-sm font-semibold">{movement.nome ?? "Movimento sem nome"}</span>
              <span className="text-xs text-neutral-600">{formatDateTime(movement.data_hora)}</span>
            </div>
            {movement.orgao_julgador && (
              <span className="text-xs text-neutral-600">{movement.orgao_julgador}</span>
            )}
            {movement.complementos.length > 0 && (
              <div className="h-stack flex-wrap gap-2">
                {movement.complementos.map((complement) => (
                  <Badge key={complement}>{complement}</Badge>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

function TimelineItem({ communication, terms }: { communication: Communication; terms: string[] }) {
  return (
    <article className="ui-card v-stack gap-3">
      <div className="h-stack flex-wrap items-center gap-2">
        <Badge>{communication.sigla_tribunal ?? "Tribunal ausente"}</Badge>
        <Badge>{communication.tipo_comunicacao ?? "Tipo ausente"}</Badge>
        <span className="h-stack items-center gap-1 text-sm text-neutral-600">
          <CalendarDays size={15} aria-hidden="true" />
          {formatDate(communication.data_disponibilizacao)}
        </span>
        {communication.external_link && (
          <a
            className="ui-icon-button"
            href={communication.external_link}
            target="_blank"
            rel="noreferrer noopener"
            title="Abrir inteiro teor"
          >
            <ExternalLink size={16} aria-hidden="true" />
          </a>
        )}
      </div>
      <RiskEvidenceList matches={communication.risk_matches} />
      <p className="whitespace-pre-wrap text-sm leading-6 text-neutral-800">
        <HighlightedText text={communication.plain_text} terms={terms} />
      </p>
    </article>
  );
}

function SelectFilter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="v-stack gap-1 text-sm font-medium">
      {label}
      <select className="ui-input" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Todos</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {label === "Data" ? formatDate(option) : option}
          </option>
        ))}
      </select>
    </label>
  );
}

function Metric({ label, value, wide = false }: { label: string; value: ReactNode; wide?: boolean }) {
  return (
    <div className={cn("v-stack gap-1 rounded-md border border-line bg-white px-3 py-2", { "md:col-span-2": wide })}>
      <span className="text-xs font-medium uppercase text-neutral-500">{label}</span>
      <span className="break-words text-sm font-semibold">{value}</span>
    </div>
  );
}

function ProcessParties({ parties, compact = false }: { parties: ProcessParty[]; compact?: boolean }) {
  if (parties.length === 0) {
    return <span className="text-xs text-neutral-500">Partes ausentes</span>;
  }
  const visibleParties = compact ? parties.slice(0, 4) : parties;
  return (
    <div className={cn("v-stack gap-1", { "max-w-[30rem]": compact })}>
      {visibleParties.map((party) => (
        <div key={`${party.name}-${party.polo}-${party.source}`} className="h-stack min-w-0 flex-wrap items-center gap-1">
          <Badge>{poloLabel(party.polo)}</Badge>
          <span className="min-w-0 break-words text-xs text-neutral-700">{party.name}</span>
          {!compact && <span className="text-[11px] font-medium uppercase text-neutral-500">{partySourceLabel(party.source)}</span>}
        </div>
      ))}
      {parties.length > visibleParties.length && (
        <span className="text-xs text-neutral-500">+{parties.length - visibleParties.length} partes</span>
      )}
    </div>
  );
}

function ProcessRiskSummary({ process, compact = false }: { process: ProcessListItem; compact?: boolean }) {
  if (process.risk_matches_count === 0 || !process.highest_risk_level) {
    return compact ? (
      <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-success">
        Sem risco
      </span>
    ) : (
      <div className="h-stack items-center gap-2 text-sm text-success">
        <ShieldCheck size={16} aria-hidden="true" />
        Nenhuma palavra de risco localizada
      </div>
    );
  }

  const visibleMatches = process.risk_matches.slice(0, compact ? 1 : 3);
  return (
    <div className="v-stack gap-1">
      <div className="h-stack flex-wrap items-center gap-2">
        <RiskLevelBadge level={process.highest_risk_level} />
        <Badge>{process.risk_matches_count} evidencias</Badge>
      </div>
      {!compact && (
        <div className="h-stack flex-wrap gap-2">
          {visibleMatches.map((match) => (
            <Badge key={match.id}>{match.keyword}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function RiskEvidenceList({ matches, compact = false }: { matches: RiskMatch[]; compact?: boolean }) {
  if (matches.length === 0) {
    return null;
  }
  const visibleMatches = compact ? matches.slice(0, 4) : matches;
  return (
    <div className="v-stack gap-2 rounded-md border border-amber-200 bg-amber-50 p-3">
      <div className="h-stack flex-wrap items-center gap-2">
        <ShieldAlert size={16} className="text-warning" aria-hidden="true" />
        <span className="text-sm font-semibold text-ink">Evidencias de risco</span>
        <Badge>{matches.length}</Badge>
      </div>
      <div className="v-stack gap-2">
        {visibleMatches.map((match) => (
          <div key={match.id} className="v-stack gap-1 rounded-md bg-white/80 p-2 text-sm">
            <div className="h-stack flex-wrap items-center gap-2">
              <RiskLevelBadge level={match.risk_level} />
              <span className="font-semibold">{match.keyword}</span>
              <Badge>{match.category}</Badge>
              <span className="text-xs text-neutral-600">{riskSourceLabel(match.source)}</span>
            </div>
            {!compact && <p className="leading-6 text-neutral-700">{match.excerpt}</p>}
          </div>
        ))}
        {matches.length > visibleMatches.length && (
          <span className="text-xs font-medium text-neutral-600">
            +{matches.length - visibleMatches.length} evidencias neste processo
          </span>
        )}
      </div>
    </div>
  );
}

function RiskLevelBadge({ level }: { level: RiskLevel }) {
  const style =
    level === "critico"
      ? "border-red-200 bg-red-50 text-danger"
      : level === "alto"
        ? "border-amber-200 bg-amber-50 text-warning"
        : level === "medio"
          ? "border-blue-200 bg-brand-50 text-brand-700"
          : "border-emerald-200 bg-emerald-50 text-success";
  return (
    <span className={cn("rounded-md border px-2 py-1 text-xs font-semibold", style)}>
      {riskLevelLabel(level)}
    </span>
  );
}

function RiskReprocessSummary({ result }: { result: RiskReprocess }) {
  return (
    <div className="grid gap-2 rounded-md border border-line bg-white p-3 text-sm sm:grid-cols-3">
      <Metric label="Lidas" value={result.scanned_communications} />
      <Metric label="Com risco" value={result.matched_communications} />
      <Metric label="Evidencias" value={result.matches_created} />
    </div>
  );
}

function WorkerQueueSummary({ dashboard }: { dashboard: WorkerDashboard }) {
  return (
    <div className="v-stack gap-3 border-t border-line pt-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <Metric label="Ativos" value={dashboard.active_workers} />
        <Metric label="Fila" value={dashboard.queued_runs} />
        <Metric label="Em execucao" value={dashboard.running_runs} />
        <Metric label="Falhas" value={dashboard.failed_runs} />
      </div>
    </div>
  );
}

function WorkerCard({
  worker,
  isStopping,
  onStop,
}: {
  worker: WorkerInstance;
  isStopping: boolean;
  onStop: () => void;
}) {
  const canStop = !["stopped", "failed"].includes(worker.effective_status) && !worker.stop_requested;
  return (
    <article className="ui-list-item v-stack gap-3">
      <div className="h-stack flex-wrap items-start gap-3">
        <div className="center h-10 w-10 shrink-0 rounded-md bg-brand-50 text-brand-700">
          <Cpu size={18} aria-hidden="true" />
        </div>
        <div className="min-w-0 grow">
          <div className="h-stack flex-wrap items-center gap-2">
            <h3 className="break-words text-base font-semibold">{worker.name}</h3>
            <WorkerStatusBadge status={worker.effective_status} />
            {worker.stop_requested && <Badge>Parada solicitada</Badge>}
          </div>
          <div className="mt-1 h-stack flex-wrap gap-2 text-xs text-neutral-600">
            <span>{worker.kind}</span>
            {worker.hostname && <span>{worker.hostname}</span>}
            {worker.process_id && <span>PID {worker.process_id}</span>}
          </div>
        </div>
        {canStop && (
          <button
            className="ui-icon-button text-danger hover:text-danger"
            type="button"
            title="Parar robo"
            disabled={isStopping}
            onClick={onStop}
          >
            <Square size={15} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <Metric label="Buscas" value={worker.processed_runs} />
        <Metric label="Sinal" value={lastSeenLabel(worker.last_seen_seconds)} />
        <Metric label="Inicio" value={formatDateTime(worker.started_at)} />
      </div>

      {worker.current_run ? (
        <WorkerRunPanel worker={worker} />
      ) : (
        <div className="rounded-md border border-line bg-neutral-50 p-3 text-sm text-neutral-700">
          {worker.effective_status === "idle" ? "Aguardando fila" : workerStatusLabel(worker.effective_status)}
        </div>
      )}

      {worker.last_error && <p className="text-sm text-danger">{worker.last_error}</p>}
    </article>
  );
}

function WorkerRunPanel({ worker }: { worker: WorkerInstance }) {
  if (!worker.current_run) {
    return null;
  }
  const run = worker.current_run;
  const progress = workerRunProgress(run.current_date, run.start_date, run.end_date);
  return (
    <div className="v-stack gap-3 rounded-md border border-brand-100 bg-brand-50 p-3">
      <div className="h-stack flex-wrap items-center gap-2">
        <span className="font-semibold">{run.client_name}</span>
        <Badge>{statusLabel(run.status)}</Badge>
        <span className="text-xs text-neutral-600">
          {formatDate(run.start_date)} - {formatDate(run.end_date)}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white">
        <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${progress}%` }} />
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <Metric label="Data" value={formatDate(run.current_date)} />
        <Metric label="Pagina" value={run.current_page} />
        <Metric label="Importadas" value={run.total_imported} />
        <Metric label="Rate limit" value={rateLimitLabel(run.rate_limit_remaining, run.rate_limit_limit)} />
      </div>
      {run.error_message && <p className="text-sm text-warning">{run.error_message}</p>}
    </div>
  );
}

function WorkerStatusBadge({ status, label }: { status: string; label?: string }) {
  const style =
    status === "working"
      ? "border-blue-200 bg-brand-50 text-brand-700"
      : status === "idle"
        ? "border-emerald-200 bg-emerald-50 text-success"
        : status === "stale"
          ? "border-amber-200 bg-amber-50 text-warning"
          : status === "failed"
            ? "border-red-200 bg-red-50 text-danger"
            : status === "stopped"
              ? "border-neutral-200 bg-neutral-50 text-neutral-600"
              : "border-neutral-200 bg-white text-neutral-700";
  return (
    <span className={cn("rounded-md border px-2 py-1 text-xs font-semibold", style)}>
      {label ?? workerStatusLabel(status)}
    </span>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return <span className="rounded-md border border-line bg-white px-2 py-1 text-xs font-medium">{children}</span>;
}

function ProcessDataStatusBadge({ status }: { status: string }) {
  const style =
    status === "synced"
      ? "border-emerald-200 bg-emerald-50 text-success"
      : status === "error"
        ? "border-red-200 bg-red-50 text-danger"
        : status === "not_found"
          ? "border-amber-200 bg-amber-50 text-warning"
          : "border-neutral-200 bg-neutral-50 text-neutral-600";
  return (
    <span className={cn("rounded-md border px-2 py-1 text-xs font-semibold", style)}>
      {processDataStatusLabel(status)}
    </span>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="center min-h-36 rounded-md border border-dashed border-line text-sm text-neutral-600">
      <span className="h-stack items-center gap-2">
        <Loader2 className="animate-spin" size={17} aria-hidden="true" />
        {label}
      </span>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="center min-h-28 rounded-md border border-dashed border-line px-4 text-center text-sm text-neutral-600">
      {label}
    </div>
  );
}

function PaginationControls({
  page,
  pageCount,
  pageSize,
  totalItems,
  itemLabel,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  totalItems: number;
  itemLabel: string;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const startItem = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const endItem = Math.min(totalItems, page * pageSize);
  return (
    <div className="h-stack flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-neutral-50 px-3 py-2">
      <span className="text-sm font-medium text-neutral-700">
        {startItem}-{endItem} de {totalItems} {itemLabel}
      </span>
      <div className="h-stack flex-wrap items-center gap-2">
        <label className="h-stack items-center gap-2 text-xs font-semibold text-neutral-600">
          Por pagina
          <select
            className="ui-input min-h-9 py-1"
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            {pageSizeOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <div className="h-stack gap-1">
          <button
            className="ui-icon-button h-9 w-9"
            type="button"
            title="Primeira pagina"
            disabled={page <= 1}
            onClick={() => onPageChange(1)}
          >
            <ChevronsLeft size={15} aria-hidden="true" />
          </button>
          <button
            className="ui-icon-button h-9 w-9"
            type="button"
            title="Pagina anterior"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft size={15} aria-hidden="true" />
          </button>
          <span className="center h-9 min-w-16 rounded-md border border-line bg-white px-2 text-xs font-semibold">
            {page}/{pageCount}
          </span>
          <button
            className="ui-icon-button h-9 w-9"
            type="button"
            title="Proxima pagina"
            disabled={page >= pageCount}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRight size={15} aria-hidden="true" />
          </button>
          <button
            className="ui-icon-button h-9 w-9"
            type="button"
            title="Ultima pagina"
            disabled={page >= pageCount}
            onClick={() => onPageChange(pageCount)}
          >
            <ChevronsRight size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

function MutationError({ error }: { error: Error | null }) {
  if (!error) {
    return null;
  }
  return <p className="text-sm text-danger">{error.message}</p>;
}

function HighlightedText({ text, terms }: { text: string; terms: string[] }) {
  const cleanTerms = terms.map((term) => term.trim()).filter(Boolean);
  if (cleanTerms.length === 0 || !text) {
    return <>{text}</>;
  }
  const regex = new RegExp(`(${cleanTerms.map(escapeRegExp).join("|")})`, "gi");
  return (
    <>
      {text.split(regex).map((part, index) => {
        const highlighted = cleanTerms.some((term) => part.toLowerCase() === term.toLowerCase());
        return highlighted ? (
          <mark key={`${part}-${index}`} className="rounded-sm bg-amber-100 px-1 text-ink">
            {part}
          </mark>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        );
      })}
    </>
  );
}

function highlightTerms(detail: ProcessDetail, client: Client | null): string[] {
  return [
    client?.name ?? "",
    ...detail.process_parties.map((party) => party.name),
    ...detail.risk_matches.map((match) => match.keyword),
    detail.formatted_number,
    detail.numero_processo,
    "prazo",
    "intimacao",
    "intimação",
    "citacao",
    "citação",
    "audiencia",
    "audiência",
    "julgamento",
    "sentenca",
    "sentença",
  ];
}

function usePaginatedItems<T>(items: T[], initialPageSize: number) {
  const [page, setPageState] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));

  useEffect(() => {
    setPageState(1);
  }, [items, pageSize]);

  useEffect(() => {
    if (page > pageCount) {
      setPageState(pageCount);
    }
  }, [page, pageCount]);

  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;

  return {
    items: items.slice(start, start + pageSize),
    page: safePage,
    pageCount,
    pageSize,
    totalItems: items.length,
    setPage: (nextPage: number) => setPageState(Math.max(1, Math.min(pageCount, nextPage))),
    setPageSize: (nextPageSize: number) => {
      setPageSizeState(nextPageSize);
      setPageState(1);
    },
  };
}

function defaultClientForm(): ClientPayload {
  return {
    name: "",
    cpf: "",
  };
}

function defaultMovementSearchForm(): MovementSearchForm {
  return searchFormForPreset("last_30");
}

function defaultRiskForm(): RiskKeywordPayload {
  return {
    term: "",
    category: "Geral",
    risk_level: "medio",
    description: "",
    active: true,
  };
}

function defaultWorkerForm(): WorkerStartPayload {
  return {
    name: "",
    max_jobs: null,
    poll_interval_seconds: 5,
  };
}

function normalizeMovementSearchOptions(payload: MovementSearchForm): MovementSearchOptions {
  return {
    startDate: payload.startDate,
    endDate: payload.endDate,
    analyzeRisks: payload.analyzeRisks,
    openMovementsWhenDone: payload.openMovementsWhenDone,
  };
}

function normalizeClientPayload(payload: ClientPayload): ClientPayload {
  return {
    name: payload.name.trim(),
    cpf: payload.cpf?.trim() || null,
  };
}

function normalizeClientUpdatePayload(payload: ClientPayload): Partial<ClientPayload> {
  const cpf = payload.cpf?.trim();
  return {
    name: payload.name.trim(),
    ...(cpf ? { cpf } : {}),
  };
}

function searchFormForPreset(
  preset: SearchPeriodPreset,
  current?: MovementSearchForm,
): MovementSearchForm {
  const today = new Date();
  let startDate = current?.startDate || dateInputValue(addDays(today, -29));
  let endDate = current?.endDate || dateInputValue(today);

  if (preset === "last_7") {
    startDate = dateInputValue(addDays(today, -6));
    endDate = dateInputValue(today);
  }
  if (preset === "last_30") {
    startDate = dateInputValue(addDays(today, -29));
    endDate = dateInputValue(today);
  }
  if (preset === "last_90") {
    startDate = dateInputValue(addDays(today, -89));
    endDate = dateInputValue(today);
  }
  if (preset === "current_month") {
    startDate = dateInputValue(new Date(today.getFullYear(), today.getMonth(), 1));
    endDate = dateInputValue(today);
  }

  return {
    preset,
    startDate,
    endDate,
    analyzeRisks: current?.analyzeRisks ?? true,
    openMovementsWhenDone: current?.openMovementsWhenDone ?? false,
  };
}

function movementSearchPeriodError(form: MovementSearchForm): string | null {
  if (!form.startDate || !form.endDate) {
    return "Informe inicio e fim do periodo.";
  }
  if (form.startDate > form.endDate) {
    return "Data inicial deve ser anterior a data final.";
  }
  return null;
}

function movementSearchPeriodDays(form: MovementSearchForm): number {
  if (!form.startDate || !form.endDate || form.startDate > form.endDate) {
    return 0;
  }
  const start = Date.parse(`${form.startDate}T00:00:00`);
  const end = Date.parse(`${form.endDate}T00:00:00`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return 0;
  }
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function dateInputValue(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeRiskPayload(payload: RiskKeywordPayload): RiskKeywordPayload {
  return {
    term: payload.term.trim(),
    category: payload.category.trim() || "Geral",
    risk_level: payload.risk_level,
    description: payload.description?.trim() || null,
    active: payload.active,
  };
}

function normalizeWorkerPayload(payload: WorkerStartPayload): WorkerStartPayload {
  return {
    name: payload.name?.trim() || null,
    max_jobs: payload.max_jobs ?? null,
    poll_interval_seconds: payload.poll_interval_seconds,
  };
}

function workerRunProgress(currentDate: string | null, startDate: string, endDate: string): number {
  const start = Date.parse(startDate);
  const end = Date.parse(endDate);
  const current = Date.parse(currentDate ?? startDate);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return currentDate ? 100 : 0;
  }
  return Math.max(0, Math.min(100, Math.round(((current - start) / (end - start)) * 100)));
}

function uniqueOptions(values: Array<string | null | undefined> | undefined): string[] {
  return Array.from(new Set((values ?? []).filter((value): value is string => Boolean(value)))).sort();
}

function poloLabel(polo: string | null | undefined): string {
  if ((polo ?? "").toUpperCase() === "A") {
    return "Polo ativo";
  }
  if ((polo ?? "").toUpperCase() === "P") {
    return "Polo passivo";
  }
  return "Parte";
}

function processDataStatusLabel(status: string): string {
  if (status === "synced") {
    return "Completo";
  }
  if (status === "not_found") {
    return "Nao encontrado";
  }
  if (status === "error") {
    return "Erro no detalhamento";
  }
  return "Pendente";
}

function partySourceLabel(source: string): string {
  if (source === "datajud") {
    return "Complementar";
  }
  if (source === "djen") {
    return "Cadastro";
  }
  return source;
}

function riskLevelLabel(level: RiskLevel): string {
  if (level === "critico") {
    return "Critico";
  }
  if (level === "alto") {
    return "Alto";
  }
  if (level === "medio") {
    return "Medio";
  }
  return "Baixo";
}

function riskSourceLabel(source: string): string {
  if (source === "texto") {
    return "Texto da comunicacao";
  }
  if (source === "partes") {
    return "Partes";
  }
  if (source === "metadados") {
    return "Metadados";
  }
  return source;
}

function riskAutomationLabel(state: RiskAutomationState): string {
  if (state.status === "pending") {
    return "Aguardando conclusao";
  }
  if (state.status === "running") {
    return "Reprocessando";
  }
  if (state.status === "completed") {
    return "Concluida";
  }
  if (state.status === "failed") {
    return "Falhou";
  }
  return "Nao solicitada";
}

function statusLabel(status: string): string {
  if (status === "queued") {
    return "Na fila";
  }
  if (status === "running") {
    return "Buscando";
  }
  if (status === "completed") {
    return "Concluida";
  }
  if (status === "failed") {
    return "Falhou";
  }
  return status;
}

function workerStatusLabel(status: string): string {
  if (status === "starting") {
    return "Iniciando";
  }
  if (status === "idle") {
    return "Aguardando";
  }
  if (status === "working") {
    return "Trabalhando";
  }
  if (status === "stopped") {
    return "Parado";
  }
  if (status === "failed") {
    return "Falhou";
  }
  if (status === "stale") {
    return "Sem sinal";
  }
  return status;
}

function lastSeenLabel(value: number | null): string {
  if (value === null) {
    return "Ausente";
  }
  if (value < 60) {
    return `${value}s`;
  }
  return `${Math.floor(value / 60)}min`;
}

function rateLimitLabel(remaining: number | null, limit: number | null): string {
  if (remaining === null && limit === null) {
    return "Ausente";
  }
  if (limit === null) {
    return String(remaining ?? "");
  }
  return `${remaining ?? "-"} / ${limit}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "Ausente";
  }
  const [year, month, day] = value.slice(0, 10).split("-");
  return day && month && year ? `${day}/${month}/${year}` : value;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "Ausente";
  }
  const date = formatDate(value);
  const time = value.length >= 16 ? value.slice(11, 16) : "";
  return time ? `${date} ${time}` : date;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
