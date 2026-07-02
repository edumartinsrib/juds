import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  FileDown,
  FileSpreadsheet,
  Gavel,
  ListFilter,
  Loader2,
  Plus,
  RefreshCw,
  RotateCw,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  Tags,
  Trash2,
  Users,
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
  deleteRiskKeyword,
  enrichProcess,
  exportUrl,
  getProcess,
  getSearchRun,
  listClients,
  listProcesses,
  listRiskKeywords,
  reprocessRiskKeywords,
  updateRiskKeyword,
} from "./api";
import { cn } from "./lib/cn";
import type {
  Client,
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
} from "./types";

const navItems = [
  { to: "/", label: "Clientes", icon: Users },
  { to: "/processos", label: "Processos", icon: BriefcaseBusiness },
  { to: "/movimentacoes", label: "Movimentacoes", icon: Gavel },
  { to: "/riscos", label: "Riscos", icon: ShieldAlert },
  { to: "/exportacoes", label: "Exportacoes", icon: FileDown },
];

const riskLevelOptions: Array<{ value: RiskLevel; label: string }> = [
  { value: "baixo", label: "Baixo" },
  { value: "medio", label: "Medio" },
  { value: "alto", label: "Alto" },
  { value: "critico", label: "Critico" },
];

export default function App() {
  const queryClient = useQueryClient();
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const clientsQuery = useQuery({ queryKey: ["clients"], queryFn: listClients });
  const clients = clientsQuery.data ?? [];

  function handleSelectClient(clientId: string) {
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

  useEffect(() => {
    const status = runQuery.data?.status;
    if (status === "completed") {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["processes"] });
    }
  }, [queryClient, runQuery.data?.status]);

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
                Consulta DJEN por pessoa e processo
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
                clientsLoading={clientsQuery.isLoading}
                onSelectClient={handleSelectClient}
                onRunCreated={setActiveRunId}
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
  clientsLoading,
  onSelectClient,
  onRunCreated,
}: {
  clients: Client[];
  selectedClient: Client | null;
  selectedClientId: string | null;
  activeRun: SearchRun | null;
  clientsLoading: boolean;
  onSelectClient: (clientId: string) => void;
  onRunCreated: (runId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");

  const createClientMutation = useMutation({
    mutationFn: createClient,
    onSuccess: (client) => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      onSelectClient(client.id);
      setName("");
    },
  });

  const searchMutation = useMutation({
    mutationFn: (clientId: string) => createSearchRun(clientId),
    onSuccess: (run) => {
      onRunCreated(run.id);
      queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
  });

  function submitClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createClientMutation.mutate({ name });
  }

  return (
    <section className="grid gap-4 py-5 lg:grid-cols-[minmax(320px,380px)_1fr]">
      <Panel title="Cliente" icon={<Users size={18} />}>
        <form className="v-stack gap-3" onSubmit={submitClient}>
          <label className="v-stack gap-1 text-sm font-medium">
            Nome
            <input
              className="ui-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              minLength={3}
              required
              autoComplete="name"
            />
          </label>
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
            onClick={() => selectedClient && searchMutation.mutate(selectedClient.id)}
          >
            {searchMutation.isPending ? (
              <Loader2 className="animate-spin" size={17} aria-hidden="true" />
            ) : (
              <Search size={17} aria-hidden="true" />
            )}
            Buscar no DJEN
          </button>
          <MutationError error={searchMutation.error} />
          <RunStatus run={activeRun} />
        </div>
      </Panel>

      <Panel title="Carteira" icon={<BriefcaseBusiness size={18} />}>
        {clientsLoading ? (
          <LoadingState label="Carregando clientes" />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {clients.map((client) => (
              <button
                key={client.id}
                type="button"
                className={cn("ui-card v-stack gap-3 text-left", {
                  "ring-2 ring-brand-500": selectedClientId === client.id,
                })}
                onClick={() => onSelectClient(client.id)}
              >
                <div className="h-stack items-start gap-3">
                  <div className="center h-9 w-9 shrink-0 rounded-md bg-brand-50 text-brand-700">
                    <Users size={17} aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{client.name}</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <Metric label="Processos" value={client.process_count} />
                  <Metric label="Movs." value={client.communication_count} />
                  <Metric label="Filas" value={client.pending_runs} />
                </div>
              </button>
            ))}
          </div>
        )}
      </Panel>
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
  onSelectClient: (clientId: string) => void;
  onSelectProcess: (processId: string) => void;
}) {
  const navigate = useNavigate();
  const [riskFilter, setRiskFilter] = useState("todos");
  const processesQuery = useQuery({
    queryKey: ["processes", selectedClientId],
    queryFn: () => listProcesses(selectedClientId),
    enabled: Boolean(selectedClientId),
  });
  const filteredProcesses = useMemo(() => {
    const processes = processesQuery.data ?? [];
    if (riskFilter === "todos") {
      return processes;
    }
    if (riskFilter === "com_risco") {
      return processes.filter((process) => process.risk_matches_count > 0);
    }
    if (riskFilter === "sem_risco") {
      return processes.filter((process) => process.risk_matches_count === 0);
    }
    return processes.filter((process) => process.highest_risk_level === riskFilter);
  }, [processesQuery.data, riskFilter]);

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
        header: "DataJud",
        accessorKey: "datajud_status",
        cell: ({ row }) => <DataJudStatusBadge status={row.original.datajud_status} />,
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
    data: filteredProcesses,
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
            {filteredProcesses.length === 0 && (
              <EmptyState label="Nenhum processo importado para o cliente selecionado." />
            )}
          </div>
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

  const processesQuery = useQuery({
    queryKey: ["processes", selectedClient?.id],
    queryFn: () => listProcesses(selectedClient?.id),
    enabled: Boolean(selectedClient?.id),
  });

  useEffect(() => {
    const processes = processesQuery.data ?? [];
    if (!selectedProcessId && processes.length > 0) {
      onSelectProcess(processes[0].id);
    }
  }, [onSelectProcess, processesQuery.data, selectedProcessId]);

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

  const typeOptions = uniqueOptions(detail?.timeline.map((item) => item.tipo_comunicacao));
  const tribunalOptions = uniqueOptions(detail?.timeline.map((item) => item.sigla_tribunal));
  const dateOptions = uniqueOptions(detail?.timeline.map((item) => item.data_disponibilizacao));

  return (
    <section className="grid gap-4 py-5 lg:grid-cols-[320px_1fr]">
      <Panel title="Processos" icon={<BriefcaseBusiness size={18} />}>
        <div className="v-stack max-h-[calc(100vh-210px)] gap-2 overflow-y-auto pr-1">
          {(processesQuery.data ?? []).map((process) => (
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
                <DataJudStatusBadge status={process.datajud_status} />
                <ProcessRiskSummary process={process} compact />
              </div>
            </button>
          ))}
          {(processesQuery.data ?? []).length === 0 && (
            <EmptyState label="Nenhum processo disponivel." />
          )}
        </div>
      </Panel>

      <Panel title="Movimentacoes" icon={<Gavel size={18} />}>
        {detailQuery.isLoading ? (
          <LoadingState label="Carregando movimentacoes" />
        ) : detail ? (
          <div className="v-stack gap-4">
            <ProcessSummary detail={detail} />
            <DataJudSummary
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
            <DataJudMovements detail={detail} />
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
                <h3 className="text-sm font-semibold">Comunicacoes DJEN</h3>
                <Badge>{filteredTimeline.length}</Badge>
              </div>
              {filteredTimeline.map((communication) => (
                <TimelineItem
                  key={communication.id}
                  communication={communication}
                  terms={highlightTerms(detail, selectedClient)}
                />
              ))}
              {filteredTimeline.length === 0 && <EmptyState label="Nenhuma movimentacao neste filtro." />}
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

  function invalidateRiskData() {
    queryClient.invalidateQueries({ queryKey: ["risk-keywords"] });
    queryClient.invalidateQueries({ queryKey: ["processes"] });
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
            Reprocessar comunicacoes
          </button>
          <MutationError error={reprocessMutation.error} />
          {lastReprocess && <RiskReprocessSummary result={lastReprocess} />}
        </div>
      </Panel>

      <Panel title="Palavras configuradas" icon={<Tags size={18} />}>
        {keywordsQuery.isLoading ? (
          <LoadingState label="Carregando palavras de risco" />
        ) : keywords.length === 0 ? (
          <EmptyState label="Cadastre a primeira palavra para classificar comunicacoes." />
        ) : (
          <div className="v-stack gap-3">
            {keywords.map((keyword) => {
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
          </div>
        )}
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
  onSelectClient: (clientId: string) => void;
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
  onSelectClient: (clientId: string) => void;
}) {
  return (
    <label className="v-stack min-w-[260px] gap-1 text-sm font-medium">
      Cliente
      <select
        className="ui-input"
        value={selectedClientId ?? ""}
        onChange={(event) => onSelectClient(event.target.value)}
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

function RunStatus({ run }: { run: SearchRun | null }) {
  if (!run) {
    return null;
  }
  const isWorking = run.status === "queued" || run.status === "running";
  const isWaitingForDjenWindow = isWorking && run.rate_limit_remaining === 0;
  const shouldShowError = Boolean(run.error_message) && run.status !== "completed" && !isWaitingForDjenWindow;
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
      {isWaitingForDjenWindow && (
        <p className="mt-2 text-warning">Aguardando nova janela do DJEN para continuar automaticamente.</p>
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

function DataJudSummary({
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
  const datajud = detail.datajud;
  return (
    <div className="v-stack gap-3 border-b border-line pb-4">
      <div className="v-stack gap-3 xl:h-stack xl:items-end">
        <div className="v-stack min-w-0 grow gap-2">
          <div className="h-stack flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">DataJud</h3>
            <DataJudStatusBadge status={datajud.status} />
            {datajud.alias && <Badge>{datajud.alias}</Badge>}
            <span className="text-xs text-neutral-600">Sync: {formatDateTime(datajud.synced_at)}</span>
          </div>
          {lastEnrichment && (
            <div className="h-stack flex-wrap gap-2 text-xs text-neutral-700">
              <Badge>DJEN {lastEnrichment.djen_items_found}</Badge>
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
            Inicio DJEN
            <input
              className="ui-input w-36"
              type="date"
              value={enrichmentStartDate}
              onChange={(event) => onEnrichmentStartDateChange(event.target.value)}
            />
          </label>
          <label className="v-stack gap-1 text-xs font-medium text-neutral-600">
            Fim DJEN
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
            Enriquecer
          </button>
        </div>
      </div>
      <MutationError error={enrichError} />
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Ajuizamento" value={formatDate(datajud.filed_at)} />
        <Metric label="Ultima Mov." value={formatDateTime(datajud.last_movement_at)} />
        <Metric label="Grau" value={datajud.degree ?? "Ausente"} />
        <Metric label="Sigilo" value={datajud.secrecy_level ?? "Ausente"} />
        <Metric label="Sistema" value={datajud.system ?? "Ausente"} />
        <Metric label="Formato" value={datajud.format ?? "Ausente"} />
        <Metric label="Atualizacao" value={formatDateTime(datajud.source_updated_at)} />
        <Metric label="Movs. DataJud" value={datajud.movements_count} />
      </div>
      {datajud.subjects.length > 0 && (
        <div className="h-stack flex-wrap gap-2">
          {datajud.subjects.map((subject) => (
            <Badge key={subject}>{subject}</Badge>
          ))}
        </div>
      )}
      {datajud.error && <p className="text-sm text-danger">{datajud.error}</p>}
    </div>
  );
}

function DataJudMovements({ detail }: { detail: ProcessDetail }) {
  const movements = detail.datajud.movements;
  if (movements.length === 0) {
    return null;
  }
  return (
    <div className="v-stack gap-3 border-b border-line pb-4">
      <div className="h-stack flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Movimentos DataJud</h3>
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
          {!compact && <span className="text-[11px] font-medium uppercase text-neutral-500">{party.source}</span>}
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

function Badge({ children }: { children: ReactNode }) {
  return <span className="rounded-md border border-line bg-white px-2 py-1 text-xs font-medium">{children}</span>;
}

function DataJudStatusBadge({ status }: { status: string }) {
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
      {datajudLabel(status)}
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

function defaultRiskForm(): RiskKeywordPayload {
  return {
    term: "",
    category: "Geral",
    risk_level: "medio",
    description: "",
    active: true,
  };
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

function datajudLabel(status: string): string {
  if (status === "synced") {
    return "DataJud ok";
  }
  if (status === "not_found") {
    return "Nao encontrado";
  }
  if (status === "error") {
    return "Erro DataJud";
  }
  return "Pendente";
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
