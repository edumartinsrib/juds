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
  RefreshCw,
  Search,
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
  createSearchRun,
  exportUrl,
  getProcess,
  getSearchRun,
  listClients,
  listProcesses,
} from "./api";
import { cn } from "./lib/cn";
import type { Client, Communication, ProcessDetail, ProcessListItem, SearchRun } from "./types";

const navItems = [
  { to: "/", label: "Clientes", icon: Users },
  { to: "/processos", label: "Processos", icon: BriefcaseBusiness },
  { to: "/movimentacoes", label: "Movimentacoes", icon: Gavel },
  { to: "/exportacoes", label: "Exportacoes", icon: FileDown },
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
        <header className="h-stack flex-wrap items-center gap-3 border-b border-line pb-4">
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
          <div className="spacer" />
          <nav className="h-stack w-full gap-2 overflow-x-auto lg:w-auto" aria-label="Principal">
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
  const [cpf, setCpf] = useState("");

  const createClientMutation = useMutation({
    mutationFn: createClient,
    onSuccess: (client) => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      onSelectClient(client.id);
      setName("");
      setCpf("");
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
    createClientMutation.mutate({ name, cpf: cpf || undefined });
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
          <label className="v-stack gap-1 text-sm font-medium">
            CPF
            <input
              className="ui-input"
              value={cpf}
              onChange={(event) => setCpf(event.target.value)}
              inputMode="numeric"
              placeholder="Opcional"
              autoComplete="off"
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
                    <p className="text-sm text-neutral-600">{client.cpf_masked ?? "CPF ausente"}</p>
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
  const processesQuery = useQuery({
    queryKey: ["processes", selectedClientId],
    queryFn: () => listProcesses(selectedClientId),
    enabled: Boolean(selectedClientId),
  });

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
        header: "Tribunal",
        accessorKey: "tribunal",
        cell: ({ row }) => <Badge>{row.original.tribunal ?? "Sem tribunal"}</Badge>,
      },
      {
        header: "CPF",
        accessorKey: "cpf_status",
        cell: ({ row }) => <CpfStatusBadge status={row.original.cpf_status} />,
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
    data: processesQuery.data ?? [],
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
        </div>
      </Panel>

      <Panel title="Resultado" icon={<ListFilter size={18} />}>
        {processesQuery.isLoading ? (
          <LoadingState label="Carregando processos" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-sm">
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
            {(processesQuery.data ?? []).length === 0 && (
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
  const [typeFilter, setTypeFilter] = useState("");
  const [tribunalFilter, setTribunalFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");

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

  const detail = detailQuery.data ?? null;
  const filteredTimeline = useMemo(() => {
    const timeline = detail?.timeline ?? [];
    return timeline.filter((communication) => {
      const byType = !typeFilter || communication.tipo_comunicacao === typeFilter;
      const byTribunal = !tribunalFilter || communication.sigla_tribunal === tribunalFilter;
      const byDate = !dateFilter || communication.data_disponibilizacao === dateFilter;
      return byType && byTribunal && byDate;
    });
  }, [dateFilter, detail?.timeline, tribunalFilter, typeFilter]);

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
              <div className="h-stack flex-wrap gap-2">
                <Badge>{process.tribunal ?? "Tribunal ausente"}</Badge>
                <CpfStatusBadge status={process.cpf_status} />
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
            <div className="grid gap-3 md:grid-cols-3">
              <SelectFilter label="Tipo" value={typeFilter} options={typeOptions} onChange={setTypeFilter} />
              <SelectFilter
                label="Tribunal"
                value={tribunalFilter}
                options={tribunalOptions}
                onChange={setTribunalFilter}
              />
              <SelectFilter label="Data" value={dateFilter} options={dateOptions} onChange={setDateFilter} />
            </div>
            <div className="v-stack gap-3">
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
    <section className="ui-panel v-stack gap-4">
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

function RunStatus({ run }: { run: SearchRun | null }) {
  if (!run) {
    return null;
  }
  const isWorking = run.status === "queued" || run.status === "running";
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
      {run.rate_limit_remaining === 0 && (
        <p className="mt-2 text-warning">DJEN pausou por limite de requisicoes.</p>
      )}
      {run.error_message && <p className="mt-2 text-danger">{run.error_message}</p>}
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
      <div className="md:col-span-4">
        <div className="h-stack flex-wrap gap-2">
          <CpfStatusBadge status={detail.cpf_status} />
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

function Badge({ children }: { children: ReactNode }) {
  return <span className="rounded-md border border-line bg-white px-2 py-1 text-xs font-medium">{children}</span>;
}

function CpfStatusBadge({ status }: { status: string }) {
  const style =
    status === "presente_no_djen"
      ? "border-emerald-200 bg-emerald-50 text-success"
      : status === "cpf_divergente"
        ? "border-red-200 bg-red-50 text-danger"
        : "border-amber-200 bg-amber-50 text-warning";
  return <span className={cn("rounded-md border px-2 py-1 text-xs font-semibold", style)}>{cpfLabel(status)}</span>;
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
    client?.cpf_masked ?? "",
    detail.formatted_number,
    detail.numero_processo,
    "prazo",
    "intimacao",
    "citacao",
    "audiencia",
    "julgamento",
    "sentenca",
  ];
}

function uniqueOptions(values: Array<string | null | undefined> | undefined): string[] {
  return Array.from(new Set((values ?? []).filter((value): value is string => Boolean(value)))).sort();
}

function cpfLabel(status: string): string {
  if (status === "presente_no_djen") {
    return "CPF presente";
  }
  if (status === "cpf_divergente") {
    return "CPF divergente";
  }
  return "CPF ausente";
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
